// Measurement tool: measures without changing drawing lines; saved annotations live in the measures bucket.
//  - Click two points: the box shows the length, the x/y difference and both points.
//  - "Add points" (Space) continues from there: every click adds a point and the total length grows.
//    Once a dimension is dragged out, Add points goes away and "Save to board" takes Space.
//    From three points the enclosed area is shaded, measured and labelled at its centre.
//    Every corner where two measured lines meet shows the angle between them (0–180°). "Stop" (Space) ends it and keeps the result.
//  - After a finished measurement, the next click clears it and starts a new one.
//  - Snap "grid": points snap to line ends, otherwise to the grid. Snap "nodes": only line ends can be picked.
//  - Stop opens a point-checkbox editor; Save stores the annotation, and clicking its text reopens it.
//  - Two-point measurements have a blue dot in the middle: drag it sideways for a CAD dimension (extension
//    lines, a parallel dimension line with arrows and the length on it). The dot's position is stored as
//    `dimension` {x, y}; the offset is its distance from the measured line. Select can drag the dot too.

import { bucket, defineBucket, checkpoint, newId } from "../store.js";
import { activeLayerId, visibleItems as layerItems, layerPrintable } from "../layers.js";

export const MEASURES = "measures";
defineBucket(MEASURES, { label: "Measurements", fields: ["id", "points", "showLengths", "showAngles", "showArea", "dimension", "layerId"] });

export const measurementGeometry = {
    bucket: MEASURES,
    annotation: true,
    // Included points, plus the dimension handle ("d", handle: true) of a dimensioned two-point measurement.
    points(item) {
        const out = item.points.flatMap((p, i) => p.enabled === false ? [] : [{ key: `p${i}`, x: p.x, y: p.y }]);
        const dim = dimensionOf(out, item.dimension);
        if (dim) out.push({ key: "d", handle: true, x: dim.mid.x, y: dim.mid.y });
        return out;
    },
    setPoint(item, key, x, y) {
        if (key === "d") {
            item.dimension = { x, y };
            return;
        }
        const point = item.points[Number(key.slice(1))];
        if (!point) throw new Error(`Unknown measurement point: ${key}`);
        point.x = x;
        point.y = y;
    }
};

const defaultDisplay = () => ({ showLengths: true, showAngles: true, showArea: true });
export const displayOf = item => ({
    showLengths: item.showLengths !== false,
    showAngles: item.showAngles !== false,
    showArea: item.showArea !== false
});

// Shoelace formula; the shape is closed back to the first point.
export function polygonArea(pts) {
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
}

// Area-weighted centre of the polygon; falls back to the point average when it is (nearly) flat.
export function polygonCentroid(pts) {
    let a2 = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        const c = p.x * q.y - q.x * p.y;
        a2 += c;
        cx += (p.x + q.x) * c;
        cy += (p.y + q.y) * c;
    }
    if (Math.abs(a2) < 1e-9) {
        return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    }
    return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

// CAD dimension of a two-point measurement: the dimension line runs parallel to a→b through `dim`.
// Null without a dimension point, with other than two points, or for a zero-length line.
export function dimensionOf(pts, dim) {
    if (!dim || pts.length !== 2) return null;
    const [a, b] = pts;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-9) return null;
    const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
    const offset = (dim.x - a.x) * nx + (dim.y - a.y) * ny;
    const a2 = { x: a.x + nx * offset, y: a.y + ny * offset }, b2 = { x: b.x + nx * offset, y: b.y + ny * offset };
    return { a, b, a2, b2, length, offset, mid: { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 } };
}

// Text angle along a→b (radians, y down on screen or up in PDF) turned so it never reads upside down.
export function readableAngle(dx, dy) {
    let angle = Math.atan2(dy, dx);
    if (angle > Math.PI / 2 + 1e-9) angle -= Math.PI;
    else if (angle <= -Math.PI / 2 + 1e-9) angle += Math.PI;
    return angle;
}

// Angle at v between the lines v→a and v→b, in degrees (0–180); null if either line has no length.
function angleAt(a, v, b) {
    const ux = a.x - v.x, uy = a.y - v.y, wx = b.x - v.x, wy = b.y - v.y;
    if (Math.hypot(ux, uy) < 1e-9 || Math.hypot(wx, wy) < 1e-9) return null;
    return Math.abs(Math.atan2(ux * wy - uy * wx, ux * wx + uy * wy)) * 180 / Math.PI;
}

// Every corner of the closed shape (the last point joins back to the first).
export function corners(points) {
    // The cursor point can sit on the last clicked point; repeated points are not corners.
    const path = points.filter((p, i) => {
        const q = points[(i - 1 + points.length) % points.length];
        return points.length < 2 || Math.hypot(p.x - q.x, p.y - q.y) > 1e-9;
    });
    const out = [];
    const n = path.length;
    if (n < 3) return out;
    for (let i = 0; i < n; i++) {
        const a = path[(i - 1 + n) % n], v = path[i], b = path[(i + 1) % n];
        const deg = angleAt(a, v, b);
        if (deg !== null) out.push({ a, v, b, deg });
    }
    return out;
}

// Label sizes: CSS px on screen, points in print. The board's print preview draws the print sizes,
// converted to screen px for the previewed page (see pdf.js, which uses the same table).
// Dimensions: arrow length and half width, extension line gap (from the point) and overshoot, text gap.
const SCREEN_SIZES = { length: 12, lengthOffset: 8, angle: 11, arcRadius: 18, arcMin: 4, angleGap: 14, area: 13, pillPad: 14, pillHeight: 22, dot: 3.5,
    arrow: 10, arrowHalf: 3.5, extGap: 3, extOver: 6, dimGap: 7 };
export const PRINT_SIZES = { length: 7, lengthOffset: 4, angle: 6.5, arcRadius: 9, arcMin: 2, angleGap: 7, area: 8, pillPad: 7, pillHeight: 11, dot: 1.5,
    arrow: 5, arrowHalf: 1.75, extGap: 1.5, extOver: 3, dimGap: 2 };
export const scaleSizes = (sizes, k) => Object.fromEntries(Object.entries(sizes).map(([key, v]) => [key, v * k]));

export const formatAngle = deg => `${Number(deg.toFixed(1))}°`;

const NODE_PX = 30; // how far from a line end a click may be in "nodes" mode
const HANDLE_PX = 10; // how far from the dimension dot a press grabs it

export function createMeasurementTool(env) {
    const visibleItems = name => env.visibleItems ? env.visibleItems(name) : layerItems(name);
    let snapMode = "grid";
    let points = [];
    let phase = "idle"; // idle | picking (1 point) | measured (2 points) | multi (adding) | done
    let hover = null;
    let editingId = null;
    let textHits = [];
    let renderingId = null;
    let display = defaultDisplay();
    let dimension = null; // {x, y} the dimension line passes through, or null
    let dimDrag = false;

    const included = () => points.filter(p => p.enabled !== false);
    const pointRows = () => points.map((p, i) => ({
        label: `P${i + 1}`, x: signed(p.x), y: signed(p.y), selected: p.enabled !== false
    }));

    // Where the dimension dot is (world): on the dimension line, or the middle of the measured line before
    // one is pulled out. Null unless the measurement being edited has exactly two included points.
    function handlePoint() {
        if (phase !== "measured" && phase !== "done") return null;
        const pts = included();
        if (pts.length !== 2) return null;
        const dim = dimensionOf(pts, dimension);
        if (dim) return dim.mid;
        return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    }

    function onHandle(sx, sy) {
        const h = handlePoint();
        if (!h) return false;
        const s = env.toScreen(h.x, h.y);
        return Math.hypot(s.x - sx, s.y - sy) <= HANDLE_PX;
    }

    // Text drawn rotated by `angle` around its centre (cx, cy); the clickable box covers it.
    function recordRotated(g, view, text, cx, cy, size, angle) {
        if (renderingId === null) return;
        const hw = g.measureText(text).width / view.dpr / 2 + 5, hh = size * 0.75;
        const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
        const w = hw * c + hh * s, h = hw * s + hh * c;
        textHits.push({ id: renderingId, left: cx - w, right: cx + w, top: cy - h, bottom: cy + h });
    }

    // `size` is the font size in CSS px; the clickable box grows with it.
    function recordText(g, view, text, x, y, size, centered = false) {
        if (renderingId === null) return;
        const width = g.measureText(text).width / view.dpr;
        textHits.push({
            id: renderingId,
            left: x - (centered ? width / 2 : 0) - 5,
            right: x + (centered ? width / 2 : width) + 5,
            top: y - (centered ? size : size * 1.35), bottom: y + (centered ? size : size * 0.4)
        });
    }

    function nearestNode(sx, sy) {
        let best = null, bestDist = NODE_PX;
        for (const geo of env.geometries) {
            for (const item of visibleItems(geo.bucket)) {
                for (const p of geo.points(item)) {
                    const s = env.toScreen(p.x, p.y);
                    const dist = Math.hypot(s.x - sx, s.y - sy);
                    if (dist <= bestDist) { best = { x: p.x, y: p.y, kind: "end" }; bestDist = dist; }
                }
            }
        }
        if (best) return best;
        for (const m of env.midpointNodes?.() ?? []) {
            const s = env.toScreen(m.x, m.y);
            const dist = Math.hypot(s.x - sx, s.y - sy);
            if (dist <= bestDist) { best = { x: m.x, y: m.y, kind: "mid" }; bestDist = dist; }
        }
        return best;
    }

    const resolve = (sx, sy) => snapMode === "nodes" ? nearestNode(sx, sy) : env.snap(sx, sy);
    const signed = v => (v < 0 ? "−" : "") + env.formatLength(Math.abs(v));

    function pathLength(pts) {
        let total = 0;
        for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        return total;
    }

    function publish() {
        if (phase === "measured") {
            const [a, b] = points;
            env.measureChanged?.({
                mode: "single",
                length: env.formatLength(Math.hypot(b.x - a.x, b.y - a.y)),
                dx: signed(b.x - a.x), dy: signed(b.y - a.y),
                ax: signed(a.x), ay: signed(a.y),
                bx: signed(b.x), by: signed(b.y),
                points: 2,
                dimension: dimension !== null
            });
        } else if (phase === "multi" || phase === "done") {
            const active = included();
            env.measureChanged?.({
                mode: phase,
                length: env.formatLength(pathLength(active)),
                area: active.length >= 3 ? env.formatArea(polygonArea(active)) : null,
                points: active.length,
                saved: editingId !== null,
                dimension: dimension !== null,
                nodes: pointRows(),
                ...display
            });
        } else {
            env.measureChanged?.(null);
        }
    }

    function setPhase(next) {
        const hadBox = phase === "measured" || phase === "multi" || phase === "done";
        phase = next;
        const hasBox = phase === "measured" || phase === "multi" || phase === "done";
        if (hadBox || hasBox) publish();
        env.redraw();
    }

    function clear() {
        if (phase === "idle") return false;
        points = [];
        editingId = null;
        display = defaultDisplay();
        dimension = null;
        dimDrag = false;
        hover = null;
        setPhase("idle");
        return true;
    }

    function drawPoint(g, view, p, filled, radius = SCREEN_SIZES.dot) {
        const d = view.dpr;
        const s = view.toScreen(p.x, p.y);
        if (filled) {
            g.fillStyle = (view.paper ? "#000" : "#8fe3ff");
            g.beginPath();
            g.arc(s.x * d, s.y * d, radius * d, 0, Math.PI * 2);
            g.fill();
        } else {
            const r = ((p.kind === "end" || p.kind === "mid" || p.kind === "ref") ? 6 : 4) * d;
            g.strokeStyle = (p.kind === "end" || p.kind === "mid" || p.kind === "ref") ? (view.paper ? "#000" : "#ff8fe0") : (view.paper ? "rgba(0,0,0,0.8)" : "rgba(255,255,255,0.8)");
            g.strokeRect(s.x * d - r, s.y * d - r, r * 2, r * 2);
        }
    }

    function angleMark(g, view, c, sz) {
        const d = view.dpr;
        const [a, v, b] = [c.a, c.v, c.b].map(p => view.toScreen(p.x, p.y));
        const la = Math.hypot(a.x - v.x, a.y - v.y), lb = Math.hypot(b.x - v.x, b.y - v.y);
        const r = Math.min(sz.arcRadius, la / 2, lb / 2);
        if (r < sz.arcMin) return;
        const a1 = Math.atan2(a.y - v.y, a.x - v.x);
        let delta = Math.atan2(b.y - v.y, b.x - v.x) - a1;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta <= -Math.PI) delta += 2 * Math.PI;
        g.strokeStyle = (view.paper ? "rgba(0,0,0,0.9)" : "rgba(255,214,120,0.9)");
        g.lineWidth = 1.5 * d;
        g.beginPath();
        g.arc(v.x * d, v.y * d, r * d, a1, a1 + delta, delta < 0);
        g.stroke();

        const mid = a1 + delta / 2;
        const tx = v.x + Math.cos(mid) * (r + sz.angleGap), ty = v.y + Math.sin(mid) * (r + sz.angleGap);
        g.font = `600 ${sz.angle * d}px system-ui, -apple-system, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillStyle = (view.paper ? "#000" : "#ffd678");
        g.shadowColor = (view.paper ? "transparent" : "rgba(0,0,0,0.8)");
        g.shadowBlur = view.fx ? 4 * d : 0;
        g.fillText(formatAngle(c.deg), tx * d, ty * d);
        recordText(g, view, formatAngle(c.deg), tx, ty, sz.angle, true);
        g.shadowBlur = 0;
        g.textAlign = "start";
        g.textBaseline = "alphabetic";
    }

    function areaLabel(g, view, text, at, sz) {
        const d = view.dpr;
        const s = view.toScreen(at.x, at.y);
        g.font = `600 ${sz.area * d}px system-ui, -apple-system, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        const w = g.measureText(text).width + sz.pillPad * d, h = sz.pillHeight * d;
        g.fillStyle = (view.paper ? "rgba(255,255,255,0.95)" : "rgba(20,16,44,0.78)");
        g.strokeStyle = (view.paper ? "rgba(0,0,0,0.7)" : "rgba(143,227,255,0.7)");
        g.lineWidth = 1 * d;
        g.beginPath();
        g.roundRect(s.x * d - w / 2, s.y * d - h / 2, w, h, h / 2);
        g.fill();
        g.stroke();
        g.fillStyle = (view.paper ? "#000" : "#8fe3ff");
        g.fillText(text, s.x * d, s.y * d);
        recordText(g, view, text, s.x, s.y, sz.area, true);
        g.textAlign = "start";
        g.textBaseline = "alphabetic";
    }

    function arrowhead(g, d, tip, ux, uy, sz) {
        const bx = tip.x - ux * sz.arrow, by = tip.y - uy * sz.arrow;
        g.beginPath();
        g.moveTo(tip.x * d, tip.y * d);
        g.lineTo((bx - uy * sz.arrowHalf) * d, (by + ux * sz.arrowHalf) * d);
        g.lineTo((bx + uy * sz.arrowHalf) * d, (by - ux * sz.arrowHalf) * d);
        g.closePath();
        g.fill();
    }

    // Extension lines from both points, the dimension line with arrows, and the length above it.
    function drawDimension(g, view, dim, text, sz) {
        const d = view.dpr;
        const [A, B, A2, B2] = [dim.a, dim.b, dim.a2, dim.b2].map(p => view.toScreen(p.x, p.y));
        const color = view.paper ? "#000" : "#8fe3ff";
        g.strokeStyle = color;
        g.fillStyle = color;
        g.lineWidth = 1 * d;
        g.beginPath();
        const ex = A2.x - A.x, ey = A2.y - A.y, el = Math.hypot(ex, ey);
        if (el > sz.extGap) {
            const ux = ex / el, uy = ey / el;
            for (const [P, Q] of [[A, A2], [B, B2]]) {
                g.moveTo((P.x + ux * sz.extGap) * d, (P.y + uy * sz.extGap) * d);
                g.lineTo((Q.x + ux * sz.extOver) * d, (Q.y + uy * sz.extOver) * d);
            }
        }
        g.moveTo(A2.x * d, A2.y * d);
        g.lineTo(B2.x * d, B2.y * d);
        g.stroke();

        const vx = B2.x - A2.x, vy = B2.y - A2.y, vl = Math.hypot(vx, vy);
        if (vl < 1e-6) return;
        const ux = vx / vl, uy = vy / vl;
        arrowhead(g, d, A2, -ux, -uy, sz);
        arrowhead(g, d, B2, ux, uy, sz);

        if (!text) return;
        const angle = readableAngle(vx, vy);
        const mx = (A2.x + B2.x) / 2, my = (A2.y + B2.y) / 2;
        g.save();
        g.translate(mx * d, my * d);
        g.rotate(angle);
        g.font = `${sz.length * d}px system-ui, -apple-system, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "bottom";
        g.fillStyle = view.paper ? "#000" : "#fff";
        g.shadowColor = view.paper ? "transparent" : "rgba(0,0,0,0.8)";
        g.shadowBlur = view.fx ? 4 * d : 0;
        g.fillText(text, 0, -sz.dimGap * d);
        g.restore();
        const up = sz.dimGap + sz.length / 2; // text centre, perpendicular above the line
        recordRotated(g, view, text, mx + Math.sin(angle) * up, my - Math.cos(angle) * up, sz.length, angle);
    }

    // The dimension dot: a ring while editing, a small dot on saved dimensions (not printed).
    function drawHandle(g, view, p, editing) {
        const d = view.dpr;
        const s = view.toScreen(p.x, p.y);
        g.beginPath();
        g.arc(s.x * d, s.y * d, (editing ? 5 : 3) * d, 0, Math.PI * 2);
        g.lineWidth = 1.5 * d;
        if (editing) {
            g.fillStyle = view.paper ? "#fff" : "rgba(20,16,44,0.9)";
            g.fill();
            g.strokeStyle = view.paper ? "#000" : "#8fe3ff";
            g.stroke();
        } else {
            g.fillStyle = view.paper ? "#666" : "#167aab";
            g.fill();
        }
    }

    function label(g, view, text, a, b, sz) {
        const d = view.dpr, o = sz.lengthOffset;
        g.font = `${sz.length * d}px system-ui, -apple-system, sans-serif`;
        g.fillStyle = (view.paper ? "#000" : "#fff");
        g.shadowColor = (view.paper ? "transparent" : "rgba(0,0,0,0.8)");
        g.shadowBlur = view.fx ? 4 * d : 0;
        g.fillText(text, ((a.x + b.x) / 2 + o) * d, ((a.y + b.y) / 2 - o) * d);
        recordText(g, view, text, (a.x + b.x) / 2 + o, (a.y + b.y) / 2 - o, sz.length);
        g.shadowBlur = 0;
    }

    function drawMeasurement(g, view, pts, state, cursor, options, dimensionPoint = null) {
        const d = view.dpr;
        const sz = view.printPx ? scaleSizes(PRINT_SIZES, view.printPx) : SCREEN_SIZES;
        const dim = (state === "measured" || state === "done") ? dimensionOf(pts, dimensionPoint) : null;
        if (dim) {
            drawDimension(g, view, dim, options.showLengths ? env.formatLength(dim.length) : null, sz);
            for (const p of pts) drawPoint(g, view, p, true, sz.dot);
            return;
        }
        const live = (state === "picking" || state === "multi") && cursor;
        const path = live ? [...pts, cursor] : pts;
        const screen = path.map(p => view.toScreen(p.x, p.y));

        if ((state === "multi" || state === "done") && path.length >= 3) {
            g.beginPath();
            screen.forEach((s, i) => i ? g.lineTo(s.x * d, s.y * d) : g.moveTo(s.x * d, s.y * d));
            g.closePath();
            g.fillStyle = (view.paper ? "rgba(0,0,0,0.06)" : "rgba(143,227,255,0.16)");
            if (options.showArea) g.fill();

            const first = screen[0], last = screen.at(-1);
            g.setLineDash([3 * d, 5 * d]);
            g.strokeStyle = (view.paper ? "rgba(0,0,0,0.45)" : "rgba(143,227,255,0.45)");
            g.lineWidth = 1 * d;
            g.beginPath();
            g.moveTo(last.x * d, last.y * d);
            g.lineTo(first.x * d, first.y * d);
            g.stroke();
            g.setLineDash([]);
        }

        if (screen.length >= 2) {
            g.setLineDash([6 * d, 5 * d]);
            g.strokeStyle = state === "picking" || live ? (view.paper ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.85)") : (view.paper ? "#000" : "#8fe3ff");
            g.lineWidth = 1.5 * d;
            g.beginPath();
            screen.forEach((s, i) => i ? g.lineTo(s.x * d, s.y * d) : g.moveTo(s.x * d, s.y * d));
            g.stroke();
            g.setLineDash([]);

            for (let i = 1; options.showLengths && i < path.length; i++) {
                const len = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
                if (len > 0) label(g, view, env.formatLength(len), screen[i - 1], screen[i], sz);
            }
        }

        if ((state === "multi" || state === "done") && path.length >= 3) {
            if (options.showAngles) for (const c of corners(path)) angleMark(g, view, c, sz);
            const area = polygonArea(path);
            if (options.showArea && area > 0) areaLabel(g, view, env.formatArea(area), polygonCentroid(path), sz);
        }

        g.lineWidth = 1.5 * d;
        for (const p of pts) {
            drawPoint(g, view, p, true, sz.dot);
        }
        if (cursor) drawPoint(g, view, cursor, false);
    }

    return {
        id: "measurement",
        hotkey: "m",

        setSnapMode(value) {
            if (value !== "grid" && value !== "nodes") throw new Error(`Unknown measurement snap mode: ${value}`);
            snapMode = value;
            hover = null;
            env.redraw();
        },

        // Continue a new or reopened measurement without changing its saved version until Save.
        addPoints() {
            if ((phase !== "measured" && phase !== "done") || dimension !== null) return false;
            hover = null;
            setPhase("multi");
            env.log("action", "measurement: adding points");
            return true;
        },

        stop() {
            if (phase !== "multi") return false;
            hover = null;
            setPhase("done");
            env.log("action", `measurement: total ${env.formatLength(pathLength(points))} over ${points.length} points`);
            return true;
        },

        togglePoint(index) {
            if (phase !== "done" || !Number.isInteger(index) || !points[index]) {
                throw new Error("Cannot toggle this measurement point");
            }
            points[index].enabled = points[index].enabled === false;
            publish();
            env.redraw();
        },

        deletePoint(index) {
            if (phase !== "done" || !Number.isInteger(index) || !points[index]) {
                throw new Error("Cannot delete this measurement point");
            }
            points.splice(index, 1);
            if (!dimensionOf(included(), dimension)) dimension = null;
            publish();
            env.redraw();
        },

        toggleDisplay(option) {
            if (phase !== "done" || !Object.hasOwn(display, option)) {
                throw new Error(`Cannot toggle measurement display option: ${option}`);
            }
            display[option] = !display[option];
            publish();
            env.redraw();
        },

        // Saves a finished measurement, or a two-point one straight from the Measurement box.
        save() {
            if ((phase !== "done" && phase !== "measured") || included().length < 2) {
                throw new Error("A saved measurement needs at least two included points");
            }
            checkpoint();
            const stored = points.map(p => ({ x: p.x, y: p.y, enabled: p.enabled !== false }));
            const dim = dimensionOf(included(), dimension) ? { x: dimension.x, y: dimension.y } : null;
            if (editingId === null) {
                bucket(MEASURES).items.push({ id: newId(), points: stored, ...display, dimension: dim, layerId: activeLayerId() });
            } else {
                const item = bucket(MEASURES).items.find(m => m.id === editingId);
                if (!item) throw new Error(`Measurement ${editingId} no longer exists`);
                item.points = stored;
                Object.assign(item, display, { dimension: dim });
            }
            env.log("action", "measurement saved");
            clear();
            env.redraw();
        },

        selectedMeasurementId: () => editingId,

        deleteMeasurement(id) {
            const saved = bucket(MEASURES);
            const index = saved.items.findIndex(item => item.id === id);
            if (index === -1) throw new Error(`Unknown measurement: ${id}`);
            checkpoint();
            saved.items.splice(index, 1);
            if (editingId === id) clear();
            textHits = [];
            env.log("action", `measurement ${id} deleted`);
            env.redraw();
        },

        open(id) {
            const item = bucket(MEASURES).items.find(m => m.id === id);
            if (!item) throw new Error(`Unknown measurement: ${id}`);
            points = structuredClone(item.points);
            editingId = id;
            display = displayOf(item);
            dimension = item.dimension ? { ...item.dimension } : null;
            hover = null;
            setPhase("done");
        },

        inspect(id) {
            const item = bucket(MEASURES).items.find(m => m.id === id);
            if (!item) throw new Error(`Unknown measurement: ${id}`);
            const active = item.points.filter(p => p.enabled !== false);
            return {
                id: item.id,
                length: env.formatLength(pathLength(active)),
                area: active.length >= 3 ? env.formatArea(polygonArea(active)) : null,
                points: active.length
            };
        },

        hitText(sx, sy) {
            const available = new Set(visibleItems(MEASURES).map(item => item.id));
            return textHits.findLast(h => available.has(h.id) && sx >= h.left && sx <= h.right && sy >= h.top && sy <= h.bottom)?.id ?? null;
        },

        drawSaved(g, view) {
            textHits = [];
            for (const item of visibleItems(MEASURES)) {
                if (view.printPx && !view.sourceGroup && !layerPrintable(item)) continue;
                if (item.id === editingId) continue;
                renderingId = item.id;
                const pts = item.points.filter(p => p.enabled !== false);
                drawMeasurement(g, view, pts, "done", null, displayOf(item), item.dimension);
                const dim = !view.printPx && !view.sourceGroup && dimensionOf(pts, item.dimension);
                if (dim) drawHandle(g, view, dim.mid, false);
            }
            renderingId = null;
        },

        deactivate() {
            clear();
            hover = null;
        },

        // Undo may move the measured line ends, so the measurement would be stale.
        dataChanged() {
            textHits = [];
            clear();
        },

        cancel: clear,

        // While adding points, undo removes the last one; otherwise it drops the measurement.
        undoStep() {
            if (phase === "multi" && points.length > 2) {
                points.pop();
                publish();
                env.redraw();
                return true;
            }
            return clear();
        },

        pointerDown(e) {
            if (onHandle(e.sx, e.sy)) {
                dimDrag = true;
                hover = null;
                if (e.pointerId !== undefined) env.capture?.(e.pointerId);
                env.redraw();
                return;
            }
            if (editingId !== null && phase !== "multi") return;
            const p = resolve(e.sx, e.sy);
            if (!p) return;
            if (phase === "multi") {
                points.push(p);
                publish();
            } else if (phase === "picking") {
                points.push(p);
                setPhase("measured");
                env.log("action", `measured ${env.formatLength(pathLength(points))}`);
            } else {
                points = [p];
                dimension = null;
                setPhase("picking");
            }
            hover = p;
            env.redraw();
        },

        pointerMove(e) {
            if (dimDrag) {
                const p = env.snap(e.sx, e.sy);
                const first = dimension === null;
                dimension = { x: p.x, y: p.y };
                if (first) publish();
                env.redraw();
                return;
            }
            hover = resolve(e.sx, e.sy);
            env.redraw();
        },

        pointerUp() {
            if (!dimDrag) return;
            dimDrag = false;
            const dim = dimensionOf(included(), dimension);
            if (dim) env.log("action", `dimension offset ${env.formatLength(Math.abs(dim.offset))}`);
        },

        pointerLeave() {
            hover = null;
            env.redraw();
        },

        draw(g, view) {
            if (editingId !== null && env.isItemVisible &&
                !env.isItemVisible(MEASURES, { points, dimension })) return;
            drawMeasurement(g, view, included(), phase, phase === "done" || dimDrag ? null : hover, display, dimension);
            const h = handlePoint();
            if (h) drawHandle(g, view, h, true);
        }
    };
}

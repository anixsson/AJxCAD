// Ruler tool: measures without changing drawing lines; saved annotations live in the measures bucket.
//  - Click two points: the box shows the length, the x/y difference and both points.
//  - "Add points" (Space) continues from there: every click adds a point and the total length grows.
//    From three points the enclosed area is shaded, measured and labelled at its centre.
//    Every corner where two measured lines meet shows the angle between them (0–180°). "Stop" (Space) ends it and keeps the result.
//  - After a finished measurement, the next click clears it and starts a new one.
//  - Snap "grid": points snap to line ends, otherwise to the grid. Snap "nodes": only line ends can be picked.
//  - Stop opens a point-checkbox editor; Save stores the annotation, and clicking its text reopens it.

import { bucket, defineBucket, checkpoint, newId } from "../store.js";

export const MEASURES = "measures";
defineBucket(MEASURES, { label: "Measurements", fields: ["id", "points", "showLengths", "showAngles", "showArea"] });

export const measurementGeometry = {
    bucket: MEASURES,
    annotation: true,
    points: item => item.points.flatMap((p, i) =>
        p.enabled === false ? [] : [{ key: `p${i}`, x: p.x, y: p.y }]),
    setPoint(item, key, x, y) {
        const point = item.points[Number(key.slice(1))];
        if (!point) throw new Error(`Unknown measurement point: ${key}`);
        point.x = x;
        point.y = y;
    }
};

const defaultDisplay = () => ({ showLengths: true, showAngles: true, showArea: true });
const displayOf = item => ({
    showLengths: item.showLengths !== false,
    showAngles: item.showAngles !== false,
    showArea: item.showArea !== false
});

const NODE_PX = 30; // how far from a line end a click may be in "nodes" mode

export function createRulerTool(env) {
    let snapMode = "grid";
    let points = [];
    let phase = "idle"; // idle | picking (1 point) | measured (2 points) | multi (adding) | done
    let hover = null;
    let editingId = null;
    let textHits = [];
    let renderingId = null;
    let display = defaultDisplay();

    const included = () => points.filter(p => p.enabled !== false);
    const pointRows = () => points.map((p, i) => ({
        label: `P${i + 1}`, x: signed(p.x), y: signed(p.y), selected: p.enabled !== false
    }));

    function recordText(g, view, text, x, y, centered = false) {
        if (renderingId === null) return;
        const width = g.measureText(text).width / view.dpr;
        textHits.push({
            id: renderingId,
            left: x - (centered ? width / 2 : 0) - 5,
            right: x + (centered ? width / 2 : width) + 5,
            top: y - (centered ? 12 : 16), bottom: y + (centered ? 12 : 5)
        });
    }

    function nearestNode(sx, sy) {
        let best = null, bestDist = NODE_PX;
        for (const geo of env.geometries) {
            for (const item of bucket(geo.bucket).items) {
                for (const p of geo.points(item)) {
                    const s = env.toScreen(p.x, p.y);
                    const dist = Math.hypot(s.x - sx, s.y - sy);
                    if (dist <= bestDist) { best = { x: p.x, y: p.y, kind: "end" }; bestDist = dist; }
                }
            }
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

    // Shoelace formula; the shape is closed back to the first point.
    function polygonArea(pts) {
        let sum = 0;
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            sum += a.x * b.y - b.x * a.y;
        }
        return Math.abs(sum) / 2;
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
                points: 2
            });
        } else if (phase === "multi" || phase === "done") {
            const active = included();
            env.measureChanged?.({
                mode: phase,
                length: env.formatLength(pathLength(active)),
                area: active.length >= 3 ? env.formatArea(polygonArea(active)) : null,
                points: active.length,
                saved: editingId !== null,
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
        hover = null;
        setPhase("idle");
        return true;
    }

    function drawPoint(g, view, p, filled) {
        const d = view.dpr;
        const s = view.toScreen(p.x, p.y);
        if (filled) {
            g.fillStyle = (view.paper ? "#000" : "#8fe3ff");
            g.beginPath();
            g.arc(s.x * d, s.y * d, 3.5 * d, 0, Math.PI * 2);
            g.fill();
        } else {
            const r = (p.kind === "end" ? 6 : 4) * d;
            g.strokeStyle = p.kind === "end" ? (view.paper ? "#000" : "#ff8fe0") : (view.paper ? "rgba(0,0,0,0.8)" : "rgba(255,255,255,0.8)");
            g.strokeRect(s.x * d - r, s.y * d - r, r * 2, r * 2);
        }
    }

    // Area-weighted centre of the polygon; falls back to the point average when it is (nearly) flat.
    function polygonCentroid(pts) {
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

    const formatAngle = deg => `${Number(deg.toFixed(1))}°`;

    // Angle at v between the lines v→a and v→b, in degrees (0–180); null if either line has no length.
    function angleAt(a, v, b) {
        const ux = a.x - v.x, uy = a.y - v.y, wx = b.x - v.x, wy = b.y - v.y;
        if (Math.hypot(ux, uy) < 1e-9 || Math.hypot(wx, wy) < 1e-9) return null;
        return Math.abs(Math.atan2(ux * wy - uy * wx, ux * wx + uy * wy)) * 180 / Math.PI;
    }

    // Every corner of the closed shape (the last point joins back to the first).
    function corners(points) {
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

    function angleMark(g, view, c) {
        const d = view.dpr;
        const [a, v, b] = [c.a, c.v, c.b].map(p => view.toScreen(p.x, p.y));
        const la = Math.hypot(a.x - v.x, a.y - v.y), lb = Math.hypot(b.x - v.x, b.y - v.y);
        const r = Math.min(18, la / 2, lb / 2);
        if (r < 4) return;
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
        const tx = v.x + Math.cos(mid) * (r + 14), ty = v.y + Math.sin(mid) * (r + 14);
        g.font = `600 ${11 * d}px system-ui, -apple-system, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillStyle = (view.paper ? "#000" : "#ffd678");
        g.shadowColor = (view.paper ? "transparent" : "rgba(0,0,0,0.8)");
        g.shadowBlur = view.fx ? 4 * d : 0;
        g.fillText(formatAngle(c.deg), tx * d, ty * d);
        recordText(g, view, formatAngle(c.deg), tx, ty, true);
        g.shadowBlur = 0;
        g.textAlign = "start";
        g.textBaseline = "alphabetic";
    }

    function areaLabel(g, view, text, at) {
        const d = view.dpr;
        const s = view.toScreen(at.x, at.y);
        g.font = `600 ${13 * d}px system-ui, -apple-system, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        const w = g.measureText(text).width + 14 * d, h = 22 * d;
        g.fillStyle = (view.paper ? "rgba(255,255,255,0.95)" : "rgba(20,16,44,0.78)");
        g.strokeStyle = (view.paper ? "rgba(0,0,0,0.7)" : "rgba(143,227,255,0.7)");
        g.lineWidth = 1 * d;
        g.beginPath();
        g.roundRect(s.x * d - w / 2, s.y * d - h / 2, w, h, h / 2);
        g.fill();
        g.stroke();
        g.fillStyle = (view.paper ? "#000" : "#8fe3ff");
        g.fillText(text, s.x * d, s.y * d);
        recordText(g, view, text, s.x, s.y, true);
        g.textAlign = "start";
        g.textBaseline = "alphabetic";
    }

    function label(g, view, text, a, b) {
        const d = view.dpr;
        g.font = `${12 * d}px system-ui, -apple-system, sans-serif`;
        g.fillStyle = (view.paper ? "#000" : "#fff");
        g.shadowColor = (view.paper ? "transparent" : "rgba(0,0,0,0.8)");
        g.shadowBlur = view.fx ? 4 * d : 0;
        g.fillText(text, (a.x + b.x) / 2 * d + 8 * d, (a.y + b.y) / 2 * d - 8 * d);
        recordText(g, view, text, (a.x + b.x) / 2 + 8, (a.y + b.y) / 2 - 8);
        g.shadowBlur = 0;
    }

    function drawMeasurement(g, view, pts, state, cursor, options) {
        const d = view.dpr;
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
                if (len > 0) label(g, view, env.formatLength(len), screen[i - 1], screen[i]);
            }
        }

        if ((state === "multi" || state === "done") && path.length >= 3) {
            if (options.showAngles) for (const c of corners(path)) angleMark(g, view, c);
            const area = polygonArea(path);
            if (options.showArea && area > 0) areaLabel(g, view, env.formatArea(area), polygonCentroid(path));
        }

        g.lineWidth = 1.5 * d;
        for (const p of pts) {
            drawPoint(g, view, p, true);
        }
        if (cursor) drawPoint(g, view, cursor, false);
    }

    return {
        id: "ruler",
        hotkey: "r",

        setSnapMode(value) {
            if (value !== "grid" && value !== "nodes") throw new Error(`Unknown ruler snap mode: ${value}`);
            snapMode = value;
            hover = null;
            env.redraw();
        },

        // Continue a two-point measurement: following clicks add points to the total.
        addPoints() {
            if (phase !== "measured") return false;
            setPhase("multi");
            env.log("action", "ruler: adding points");
            return true;
        },

        stop() {
            if (phase !== "multi") return false;
            hover = null;
            setPhase("done");
            env.log("action", `ruler: total ${env.formatLength(pathLength(points))} over ${points.length} points`);
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

        toggleDisplay(option) {
            if (phase !== "done" || !Object.hasOwn(display, option)) {
                throw new Error(`Cannot toggle measurement display option: ${option}`);
            }
            display[option] = !display[option];
            publish();
            env.redraw();
        },

        save() {
            if (phase !== "done" || included().length < 2) {
                throw new Error("A saved measurement needs at least two included points");
            }
            checkpoint();
            const stored = points.map(p => ({ x: p.x, y: p.y, enabled: p.enabled !== false }));
            if (editingId === null) {
                bucket(MEASURES).items.push({ id: newId(), points: stored, ...display });
            } else {
                const item = bucket(MEASURES).items.find(m => m.id === editingId);
                if (!item) throw new Error(`Measurement ${editingId} no longer exists`);
                item.points = stored;
                Object.assign(item, display);
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
            return textHits.findLast(h => sx >= h.left && sx <= h.right && sy >= h.top && sy <= h.bottom)?.id ?? null;
        },

        drawSaved(g, view) {
            textHits = [];
            for (const item of bucket(MEASURES).items) {
                if (item.id === editingId) continue;
                renderingId = item.id;
                drawMeasurement(g, view, item.points.filter(p => p.enabled !== false), "done", null, displayOf(item));
            }
            renderingId = null;
        },

        deactivate() {
            clear();
            hover = null;
        },

        // Undo may move the measured line ends, so the measurement would be stale.
        dataChanged() {
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
            if (editingId !== null) return;
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
                setPhase("picking");
            }
            hover = p;
            env.redraw();
        },

        pointerMove(e) {
            hover = resolve(e.sx, e.sy);
            env.redraw();
        },

        pointerLeave() {
            hover = null;
            env.redraw();
        },

        draw(g, view) {
            drawMeasurement(g, view, included(), phase, phase === "done" ? null : hover, display);
        }
    };
}

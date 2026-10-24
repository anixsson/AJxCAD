// Ruler tool: measures without changing the drawing.
//  - Click two points: the box shows the length, the x/y difference and both points.
//  - "Add points" (Space) continues from there: every click adds a point and the total length grows.
//    From three points the enclosed area is shaded and measured. "Stop" (Space) ends it and keeps the result.
//  - After a finished measurement, the next click clears it and starts a new one.
//  - Snap "grid": points snap to line ends, otherwise to the grid. Snap "nodes": only line ends can be picked.

import { bucket } from "../store.js";

const NODE_PX = 30; // how far from a line end a click may be in "nodes" mode

export function createRulerTool(env) {
    let snapMode = "grid";
    let points = [];
    let phase = "idle"; // idle | picking (1 point) | measured (2 points) | multi (adding) | done
    let hover = null;

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
            env.measureChanged?.({
                mode: phase,
                length: env.formatLength(pathLength(points)),
                area: points.length >= 3 ? env.formatArea(polygonArea(points)) : null,
                points: points.length
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
        setPhase("idle");
        return true;
    }

    function drawPoint(g, view, p, filled) {
        const d = view.dpr;
        const s = view.toScreen(p.x, p.y);
        if (filled) {
            g.fillStyle = "#ff8fe0";
            g.beginPath();
            g.arc(s.x * d, s.y * d, 3.5 * d, 0, Math.PI * 2);
            g.fill();
        } else {
            const r = (p.kind === "end" ? 6 : 4) * d;
            g.strokeStyle = p.kind === "end" ? "#ff8fe0" : "rgba(255,255,255,0.8)";
            g.strokeRect(s.x * d - r, s.y * d - r, r * 2, r * 2);
        }
    }

    function label(g, view, text, a, b) {
        const d = view.dpr;
        g.font = `${12 * d}px system-ui, -apple-system, sans-serif`;
        g.fillStyle = "#fff";
        g.shadowColor = "rgba(0,0,0,0.8)";
        g.shadowBlur = view.fx ? 4 * d : 0;
        g.fillText(text, (a.x + b.x) / 2 * d + 8 * d, (a.y + b.y) / 2 * d - 8 * d);
        g.shadowBlur = 0;
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
            setPhase("done");
            env.log("action", `ruler: total ${env.formatLength(pathLength(points))} over ${points.length} points`);
            return true;
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
            const d = view.dpr;
            const live = (phase === "picking" || phase === "multi") && hover;
            const path = live ? [...points, hover] : points;
            const screen = path.map(p => view.toScreen(p.x, p.y));

            // Shaded area once there are three or more points.
            if ((phase === "multi" || phase === "done") && path.length >= 3) {
                g.beginPath();
                screen.forEach((s, i) => i ? g.lineTo(s.x * d, s.y * d) : g.moveTo(s.x * d, s.y * d));
                g.closePath();
                g.fillStyle = "rgba(143,227,255,0.16)";
                g.fill();

                const first = screen[0], last = screen.at(-1);
                g.setLineDash([3 * d, 5 * d]);
                g.strokeStyle = "rgba(143,227,255,0.45)";
                g.lineWidth = 1 * d;
                g.beginPath();
                g.moveTo(last.x * d, last.y * d);
                g.lineTo(first.x * d, first.y * d);
                g.stroke();
                g.setLineDash([]);
            }

            if (screen.length >= 2) {
                g.setLineDash([6 * d, 5 * d]);
                g.strokeStyle = phase === "picking" || live ? "rgba(255,255,255,0.85)" : "#8fe3ff";
                g.lineWidth = 1.5 * d;
                g.beginPath();
                screen.forEach((s, i) => i ? g.lineTo(s.x * d, s.y * d) : g.moveTo(s.x * d, s.y * d));
                g.stroke();
                g.setLineDash([]);

                // Length of each segment along the path.
                for (let i = 1; i < path.length; i++) {
                    const len = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
                    if (len > 0) label(g, view, env.formatLength(len), screen[i - 1], screen[i]);
                }
            }

            g.lineWidth = 1.5 * d;
            for (const p of points) drawPoint(g, view, p, true);
            if (hover) drawPoint(g, view, hover, false);
        }
    };
}

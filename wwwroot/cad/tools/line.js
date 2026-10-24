// Line tool: click to place a start point, click again to place the end; it keeps chaining until the tool ends.
// Space ends the current chain (placed lines stay) so the next click starts a new line.
// With Multi off (toolmenu), every line ends after its second click.

import { checkpoint } from "../store.js";
import { addLine } from "../lines.js";

export function createLineTool(env) {
    let start = null;
    let hover = null;
    let multi = true;

    // Snaps to endpoints and the grid; Shift locks the angle to 45 degree steps from the start point.
    function resolve(e) {
        let p = env.snap(e.sx, e.sy);
        if (e.shift && start && p.kind !== "end") {
            const w = env.toWorld(e.sx, e.sy);
            const g = env.minorStepMm();
            const dx = w.x - start.x, dy = w.y - start.y;
            const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
            const len = Math.round(Math.hypot(dx, dy) / g) * g;
            p = { x: start.x + Math.cos(a) * len, y: start.y + Math.sin(a) * len, kind: "grid" };
        }
        return p;
    }

    return {
        id: "line",
        hotkey: "l",

        deactivate() {
            start = null;
            hover = null;
        },

        pointerDown(e) {
            if (e.detail >= 2) { env.setTool("cross"); return; } // double-click ends the tool
            const p = resolve(e);
            if (!start) start = p;
            else if (p.x !== start.x || p.y !== start.y) {
                checkpoint();
                addLine(start.x, start.y, p.x, p.y);
                env.log("action", `line placed, length ${env.formatLength(Math.hypot(p.x - start.x, p.y - start.y))}`);
                start = multi ? p : null;
            }
            hover = p;
            env.redraw();
        },

        pointerMove(e) {
            hover = resolve(e);
            env.redraw();
        },

        pointerLeave() {
            hover = null;
            env.redraw();
        },

        setMulti(on) {
            multi = !!on;
            start = null;
            env.redraw();
        },

        space() {
            if (!start) return false;
            start = null;
            env.log("action", "line chain ended");
            env.redraw();
            return true;
        },

        // First undo drops the line being drawn, the next ones remove placed lines.
        undoStep() {
            if (!start) return false;
            start = null;
            return true;
        },

        draw(g, view) {
            const d = view.dpr;
            if (start && hover) {
                const a = view.toScreen(start.x, start.y), b = view.toScreen(hover.x, hover.y);
                g.setLineDash([6 * d, 5 * d]);
                g.strokeStyle = "rgba(255,255,255,0.85)";
                g.lineWidth = 1.5 * d;
                g.beginPath();
                g.moveTo(a.x * d, a.y * d);
                g.lineTo(b.x * d, b.y * d);
                g.stroke();
                g.setLineDash([]);

                const len = Math.hypot(hover.x - start.x, hover.y - start.y);
                if (len > 0) {
                    g.font = `${12 * d}px system-ui, -apple-system, sans-serif`;
                    g.fillStyle = "#fff";
                    g.shadowColor = "rgba(0,0,0,0.8)";
                    g.shadowBlur = view.fx ? 4 * d : 0;
                    g.fillText(env.formatLength(len), (a.x + b.x) / 2 * d + 8 * d, (a.y + b.y) / 2 * d - 8 * d);
                    g.shadowBlur = 0;
                }
            }

            g.lineWidth = 1.5 * d;
            if (start) {
                const p = view.toScreen(start.x, start.y);
                g.fillStyle = "#ff8fe0";
                g.beginPath();
                g.arc(p.x * d, p.y * d, 3.5 * d, 0, Math.PI * 2);
                g.fill();
            }
            if (hover) {
                const p = view.toScreen(hover.x, hover.y);
                const r = (hover.kind === "end" ? 6 : 4) * d;
                g.strokeStyle = hover.kind === "end" ? "#ff8fe0" : "rgba(255,255,255,0.8)";
                g.strokeRect(p.x * d - r, p.y * d - r, r * 2, r * 2);
            }
        }
    };
}

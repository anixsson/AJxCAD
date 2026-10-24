// Select tool: highlights the corners (line ends) near the cursor, click to select, drag to move.
//  - Click a corner to select it; Shift+click adds or removes corners; click empty space to clear.
//  - Dragging a selected corner moves every selected corner together.
//  - A corner shared by several lines moves as one, so joined lines stay joined.
//  - With a single free end selected, only that one line changes.

import { bucket, checkpoint } from "../store.js";

const HIT_PX = 10;
const DRAG_PX = 3;
const SAME = 1e-6; // mm; points closer than this are the same corner

export function createSelectTool(env) {
    const selected = new Map(); // ref key -> ref
    let hover = null;
    let drag = null;
    let marker = null;

    const keyOf = (geo, item, key) => `${geo.bucket}:${item.id}:${key}`;
    const refKey = r => keyOf(r.geo, r.item, r.key);

    function allPoints() {
        const out = [];
        for (const geo of env.geometries) {
            for (const item of bucket(geo.bucket).items) {
                for (const p of geo.points(item)) out.push({ geo, item, key: p.key, x: p.x, y: p.y });
            }
        }
        return out;
    }

    // The corner under the cursor: its position plus every line end sitting on it.
    function findNode(sx, sy) {
        // Cheap world-space box test first, so far-away points never get converted to screen space.
        const w = env.toWorld(sx, sy);
        const reach = Math.abs(env.toWorld(sx + HIT_PX, sy).x - w.x);
        let best = null, bestDist = HIT_PX;
        for (const geo of env.geometries) {
            for (const item of bucket(geo.bucket).items) {
                for (const p of geo.points(item)) {
                    if (Math.abs(p.x - w.x) > reach || Math.abs(p.y - w.y) > reach) continue;
                    const s = env.toScreen(p.x, p.y);
                    const dist = Math.hypot(s.x - sx, s.y - sy);
                    if (dist <= bestDist) { best = { geo, item, key: p.key, x: p.x, y: p.y }; bestDist = dist; }
                }
            }
        }
        if (!best) return null;
        return {
            x: best.x,
            y: best.y,
            refs: allPoints().filter(p => Math.abs(p.x - best.x) < SAME && Math.abs(p.y - best.y) < SAME)
        };
    }

    const isSelected = node => node.refs.every(r => selected.has(refKey(r)));
    const addNode = node => node.refs.forEach(r => selected.set(refKey(r), r));
    const removeNode = node => node.refs.forEach(r => selected.delete(refKey(r)));

    function selectInRect(rect, base, mode) {
        selected.clear();
        for (const [key, ref] of base) selected.set(key, ref);
        const left = Math.min(rect.sx, rect.x), right = Math.max(rect.sx, rect.x);
        const top = Math.min(rect.sy, rect.y), bottom = Math.max(rect.sy, rect.y);
        for (const p of allPoints()) {
            const s = env.toScreen(p.x, p.y);
            if (s.x >= left && s.x <= right && s.y >= top && s.y <= bottom) {
                if (mode === "remove") selected.delete(refKey(p));
                else selected.set(refKey(p), p);
            }
        }
    }

    function report() {
        env.log("action", `selected ${selected.size} line end${selected.size === 1 ? "" : "s"}`);
    }

    return {
        id: "select",
        hotkey: "s",

        deactivate() {
            selected.clear();
            hover = null;
            drag = null;
            marker = null;
        },

        // Undo replaces the stored items, so any selection would point at stale data.
        dataChanged() {
            selected.clear();
            drag = null;
        },

        pointerDown(e) {
            const node = findNode(e.sx, e.sy);
            if (!node) {
                const mode = e.shift ? (e.control ? "remove" : "add") : "replace";
                drag = {
                    kind: "marquee",
                    sx: e.sx,
                    sy: e.sy,
                    x: e.sx,
                    y: e.sy,
                    moved: false,
                    shift: e.shift,
                    mode,
                    base: mode === "replace" ? new Map() : new Map(selected)
                };
                env.capture(e.pointerId);
                env.redraw();
                return;
            }

            if (e.shift && e.control) {
                removeNode(node);
                report();
                env.redraw();
                return;
            }

            const alreadySelected = isSelected(node);
            if (!alreadySelected) {
                if (!e.shift) selected.clear();
                addNode(node);
                report();
            }

            const origin = new Map();
            for (const [k, r] of selected) {
                const p = r.geo.points(r.item).find(q => q.key === r.key);
                origin.set(k, { ref: r, x: p.x, y: p.y });
            }
            drag = {
                kind: "move",
                anchor: { x: node.x, y: node.y },
                sx: e.sx,
                sy: e.sy,
                origin,
                moved: false,
                toggleOnRelease: alreadySelected && e.shift ? node : null
            };
            env.capture(e.pointerId);
            env.redraw();
        },

        pointerMove(e) {
            if (!drag) {
                hover = findNode(e.sx, e.sy);
                env.redraw();
                return;
            }
            if (drag.kind === "marquee") {
                if (!drag.moved && Math.hypot(e.sx - drag.sx, e.sy - drag.sy) < DRAG_PX) return;
                drag.moved = true;
                drag.x = e.sx;
                drag.y = e.sy;
                selectInRect(drag, drag.base, drag.mode);
                env.redraw();
                return;
            }
            if (!drag.moved) {
                if (Math.hypot(e.sx - drag.sx, e.sy - drag.sy) < DRAG_PX) return;
                checkpoint();
                drag.moved = true;
                env.log("action", `drag ${selected.size} line end${selected.size === 1 ? "" : "s"}`);
            }
            // Snap to grid or to ends that are not being moved.
            const p = env.snap(e.sx, e.sy, (geo, item, key) => selected.has(keyOf(geo, item, key)));
            const dx = p.x - drag.anchor.x, dy = p.y - drag.anchor.y;
            for (const o of drag.origin.values()) o.ref.geo.setPoint(o.ref.item, o.ref.key, o.x + dx, o.y + dy);
            marker = p;
            env.redraw();
        },

        pointerUp(e) {
            if (!drag) return;
            if (drag.kind === "marquee") {
                if (drag.moved) {
                    drag.x = e.sx;
                    drag.y = e.sy;
                    selectInRect(drag, drag.base, drag.mode);
                    report();
                } else if (!drag.shift && selected.size) {
                    selected.clear();
                    report();
                }
                drag = null;
                hover = findNode(e.sx, e.sy);
                env.redraw();
                return;
            }
            if (!drag.moved && drag.toggleOnRelease) {
                removeNode(drag.toggleOnRelease);
                report();
            }
            drag = null;
            marker = null;
            hover = findNode(e.sx, e.sy);
            env.redraw();
        },

        pointerLeave() {
            if (drag) return;
            hover = null;
            env.redraw();
        },

        draw(g, view) {
            const d = view.dpr;
            g.lineWidth = 1.5 * d;

            // Only points on screen get a marker.
            for (const p of allPoints()) {
                const s = view.toScreen(p.x, p.y);
                if (s.x < -10 || s.x > view.width + 10 || s.y < -10 || s.y > view.height + 10) continue;
                if (selected.has(refKey(p))) {
                    const r = 4.5 * d;
                    g.fillStyle = "#ff8fe0";
                    g.shadowColor = "rgba(255,143,224,0.8)";
                    g.shadowBlur = view.fx ? 8 * d : 0;
                    g.fillRect(s.x * d - r, s.y * d - r, r * 2, r * 2);
                    g.shadowBlur = 0;
                } else {
                    const r = 3 * d;
                    g.strokeStyle = "rgba(255,255,255,0.55)";
                    g.strokeRect(s.x * d - r, s.y * d - r, r * 2, r * 2);
                }
            }

            if (hover && !drag) {
                const s = view.toScreen(hover.x, hover.y);
                const r = 8 * d;
                g.strokeStyle = "#8fe3ff";
                g.shadowColor = "rgba(111,208,255,0.9)";
                g.shadowBlur = view.fx ? 8 * d : 0;
                g.strokeRect(s.x * d - r, s.y * d - r, r * 2, r * 2);
                g.shadowBlur = 0;
            }

            if (marker && drag?.moved) {
                const s = view.toScreen(marker.x, marker.y);
                const r = (marker.kind === "end" ? 8 : 6) * d;
                g.strokeStyle = marker.kind === "end" ? "#ff8fe0" : "rgba(255,255,255,0.8)";
                g.strokeRect(s.x * d - r, s.y * d - r, r * 2, r * 2);
            }

            if (drag?.kind === "marquee" && drag.moved) {
                const left = Math.min(drag.sx, drag.x) * d;
                const top = Math.min(drag.sy, drag.y) * d;
                const width = Math.abs(drag.x - drag.sx) * d;
                const height = Math.abs(drag.y - drag.sy) * d;
                g.fillStyle = "rgba(143,227,255,0.12)";
                g.fillRect(left, top, width, height);
                g.strokeStyle = "rgba(143,227,255,0.9)";
                g.setLineDash([5 * d, 4 * d]);
                g.strokeRect(left, top, width, height);
                g.setLineDash([]);
            }
        }
    };
}

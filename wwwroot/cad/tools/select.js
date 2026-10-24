// Select tool: highlights the corners (line ends) near the cursor, click to select, drag to move.
//  - Click a corner to select it; Shift+click adds or removes corners; click empty space to clear.
//  - Dragging a selected corner moves every selected corner together.
//  - Lines mode selects both corners of a clicked line; lines with both ends selected are highlighted.
//  - Move (action menu): pick a base point, press Next, then pick where the base point should go.
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
    let mode = "nodes";
    let process = null; // guided Move: { step: "base" | "target", base, point }
    let lastCount = 0;

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

    function findLine(sx, sy) {
        let best = null, bestDist = HIT_PX;
        for (const geo of env.geometries) {
            for (const item of bucket(geo.bucket).items) {
                const points = geo.points(item);
                if (points.length !== 2) continue;
                const [a, b] = points.map(p => env.toScreen(p.x, p.y));
                const dx = b.x - a.x, dy = b.y - a.y;
                const lengthSquared = dx * dx + dy * dy;
                const t = lengthSquared ? Math.max(0, Math.min(1, ((sx - a.x) * dx + (sy - a.y) * dy) / lengthSquared)) : 0;
                const x = a.x + t * dx, y = a.y + t * dy;
                const distance = Math.hypot(sx - x, sy - y);
                if (distance <= bestDist) {
                    bestDist = distance;
                    best = { ...env.toWorld(x, y), points };
                }
            }
        }
        if (!best) return null;
        return {
            x: best.x, y: best.y, points: best.points,
            refs: allPoints().filter(p => best.points.some(q => Math.abs(p.x - q.x) < SAME && Math.abs(p.y - q.y) < SAME))
        };
    }

    // A grabbed node is its own anchor. A line can be grabbed anywhere, so start from the nearest
    // grid point; moves then stay in whole grid steps.
    function dragAnchor(node) {
        if (mode !== "lines") return { x: node.x, y: node.y };
        const s = env.toScreen(node.x, node.y);
        const g = env.snap(s.x, s.y, () => true);
        return { x: g.x, y: g.y };
    }

    const findTarget = (sx, sy) => mode === "lines" ? findLine(sx, sy) : findNode(sx, sy);

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
        notifySelection();
    }

    function notifySelection() {
        if (selected.size === lastCount) return;
        lastCount = selected.size;
        env.selectionChanged?.(lastCount);
    }

    function setProcess(next) {
        process = next;
        env.processChanged?.(process && { step: process.step, hasBase: !!process.base });
        env.redraw();
    }

    const excludeSelected = (geo, item, key) => selected.has(keyOf(geo, item, key));

    function moveSelection(dx, dy) {
        for (const r of selected.values()) {
            const p = r.geo.points(r.item).find(q => q.key === r.key);
            r.geo.setPoint(r.item, r.key, p.x + dx, p.y + dy);
        }
    }

    function drawGuide(g, view, from, to) {
        const d = view.dpr;
        const a = view.toScreen(from.x, from.y);
        const s = view.toScreen(to.x, to.y);
        g.setLineDash([6 * d, 5 * d]);
        g.strokeStyle = "rgba(255,255,255,0.85)";
        g.beginPath();
        g.moveTo(a.x * d, a.y * d);
        g.lineTo(s.x * d, s.y * d);
        g.stroke();
        g.setLineDash([]);

        const offset = Math.hypot(to.x - from.x, to.y - from.y);
        g.font = `${12 * d}px system-ui, -apple-system, sans-serif`;
        g.fillStyle = "#fff";
        g.shadowColor = "rgba(0,0,0,0.8)";
        g.shadowBlur = view.fx ? 4 * d : 0;
        g.fillText(`Offset ${env.formatLength(offset)}`, (a.x + s.x) / 2 * d + 8 * d, (a.y + s.y) / 2 * d - 8 * d);
        g.shadowBlur = 0;
    }

    function drawSnapMarker(g, view, p) {
        const d = view.dpr;
        const s = view.toScreen(p.x, p.y);
        const r = (p.kind === "end" ? 8 : 6) * d;
        g.strokeStyle = p.kind === "end" ? "#ff8fe0" : "rgba(255,255,255,0.8)";
        g.strokeRect(s.x * d - r, s.y * d - r, r * 2, r * 2);
    }

    // The selection as it would look after moving by (dx, dy); lines with one selected end stretch.
    function drawMovePreview(g, view, dx, dy) {
        const d = view.dpr;
        g.beginPath();
        for (const geo of env.geometries) {
            for (const item of bucket(geo.bucket).items) {
                const points = geo.points(item);
                if (points.length !== 2 || !points.some(p => selected.has(keyOf(geo, item, p.key)))) continue;
                const [a, b] = points.map(p => {
                    const moved = selected.has(keyOf(geo, item, p.key));
                    return view.toScreen(p.x + (moved ? dx : 0), p.y + (moved ? dy : 0));
                });
                g.moveTo(a.x * d, a.y * d);
                g.lineTo(b.x * d, b.y * d);
            }
        }
        g.setLineDash([4 * d, 4 * d]);
        g.strokeStyle = "rgba(255,143,224,0.6)";
        g.lineWidth = 2 * d;
        g.stroke();
        g.setLineDash([]);
        g.lineWidth = 1.5 * d;
    }

    return {
        id: "select",
        hotkey: "s",

        startMove() {
            if (!selected.size) return false;
            drag = null;
            hover = null;
            marker = null;
            setProcess({ step: "base", base: null, point: null });
            env.log("action", "move: pick a base point");
            return true;
        },

        confirmMoveBase() {
            if (process?.step !== "base" || !process.base) return false;
            setProcess({ step: "target", base: process.base, point: null });
            env.log("action", "move: pick the destination");
            return true;
        },

        cancelProcess() {
            if (!process) return false;
            setProcess(null);
            env.log("action", "move cancelled");
            return true;
        },

        // Undo first cancels a running Move, the next ones undo drawing edits.
        undoStep() {
            return this.cancelProcess();
        },

        setSelectionMode(value) {
            if (value !== "nodes" && value !== "lines") throw new Error(`Unknown selection mode: ${value}`);
            mode = value;
            hover = null;
            drag = null;
            marker = null;
            env.redraw();
        },

        deactivate() {
            selected.clear();
            hover = null;
            drag = null;
            marker = null;
            if (process) setProcess(null);
            notifySelection();
        },

        // Undo replaces the stored items, so any selection would point at stale data.
        dataChanged() {
            selected.clear();
            drag = null;
            hover = null;
            marker = null;
            if (process) setProcess(null);
            notifySelection();
        },

        pointerDown(e) {
            if (process) {
                if (process.step === "base") {
                    process.base = env.snap(e.sx, e.sy);
                    setProcess(process);
                    return;
                }
                const p = env.snap(e.sx, e.sy, excludeSelected);
                const dx = p.x - process.base.x, dy = p.y - process.base.y;
                checkpoint();
                moveSelection(dx, dy);
                env.log("action", `moved ${selected.size} line end${selected.size === 1 ? "" : "s"} by ${env.formatLength(Math.hypot(dx, dy))}`);
                setProcess(null);
                return;
            }
            const node = findTarget(e.sx, e.sy);
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
                anchor: dragAnchor(node),
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
            if (process) {
                process.point = env.snap(e.sx, e.sy, process.step === "target" ? excludeSelected : undefined);
                env.redraw();
                return;
            }
            if (!drag) {
                hover = findTarget(e.sx, e.sy);
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
                hover = findTarget(e.sx, e.sy);
                env.redraw();
                return;
            }
            if (!drag.moved && drag.toggleOnRelease) {
                removeNode(drag.toggleOnRelease);
                report();
            }
            drag = null;
            marker = null;
            hover = findTarget(e.sx, e.sy);
            env.redraw();
        },

        pointerLeave() {
            if (process) {
                process.point = null;
                env.redraw();
                return;
            }
            if (drag) return;
            hover = null;
            env.redraw();
        },

        draw(g, view) {
            const d = view.dpr;
            g.lineWidth = 1.5 * d;

            for (const geo of env.geometries) {
                g.beginPath();
                let count = 0;
                for (const item of bucket(geo.bucket).items) {
                    const points = geo.points(item);
                    if (points.length !== 2) continue;
                    if (!points.every(p => selected.has(keyOf(geo, item, p.key)))) continue;
                    const [a, b] = points.map(p => view.toScreen(p.x, p.y));
                    if ((a.x < 0 && b.x < 0) || (a.x > view.width && b.x > view.width) ||
                        (a.y < 0 && b.y < 0) || (a.y > view.height && b.y > view.height)) continue;
                    g.moveTo(a.x * d, a.y * d);
                    g.lineTo(b.x * d, b.y * d);
                    count++;
                }
                g.lineWidth = 3 * d;
                g.strokeStyle = "#ff8fe0";
                g.shadowColor = "rgba(255,143,224,0.8)";
                g.shadowBlur = view.fx && count <= 400 ? 8 * d : 0;
                g.stroke();
                g.shadowBlur = 0;
            }
            g.lineWidth = 1.5 * d;

            if (mode === "lines" && hover && !drag && !isSelected(hover)) {
                const [a, b] = hover.points.map(p => view.toScreen(p.x, p.y));
                g.beginPath();
                g.moveTo(a.x * d, a.y * d);
                g.lineTo(b.x * d, b.y * d);
                g.strokeStyle = "#8fe3ff";
                g.lineWidth = 3 * d;
                g.stroke();
                g.lineWidth = 1.5 * d;
            }

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

            if (hover && !drag && mode === "nodes") {
                const s = view.toScreen(hover.x, hover.y);
                const r = 8 * d;
                g.strokeStyle = "#8fe3ff";
                g.shadowColor = "rgba(111,208,255,0.9)";
                g.shadowBlur = view.fx ? 8 * d : 0;
                g.strokeRect(s.x * d - r, s.y * d - r, r * 2, r * 2);
                g.shadowBlur = 0;
            }

            if (marker && drag?.kind === "move" && drag.moved) {
                drawGuide(g, view, drag.anchor, marker);
                drawSnapMarker(g, view, marker);
            }

            if (process) {
                if (process.step === "target" && process.point) {
                    drawMovePreview(g, view, process.point.x - process.base.x, process.point.y - process.base.y);
                    drawGuide(g, view, process.base, process.point);
                }
                if (process.point) drawSnapMarker(g, view, process.point);
                if (process.base) {
                    const s = view.toScreen(process.base.x, process.base.y);
                    const r = 9 * d;
                    g.strokeStyle = "#8fe3ff";
                    g.lineWidth = 2 * d;
                    g.beginPath();
                    g.moveTo(s.x * d - r, s.y * d);
                    g.lineTo(s.x * d + r, s.y * d);
                    g.moveTo(s.x * d, s.y * d - r);
                    g.lineTo(s.x * d, s.y * d + r);
                    g.stroke();
                    g.lineWidth = 1.5 * d;
                }
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

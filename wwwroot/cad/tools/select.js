// Select tool: highlights the corners (line ends) near the cursor, click to select, drag to move.
//  - Click a corner to select it; Shift+click adds or removes corners; click empty space to clear.
//  - Dragging a selected corner moves every selected corner together.
//  - Lines mode selects both corners of a clicked line; lines with both ends selected are highlighted.
//  - Lines mode: a selected line shows a handle in its middle. Dragging it splits the line in two
//    and moves the new shared corner.
//  - Move (action menu): pick a base point, press Next, then pick where the base point should go.
//  - A corner shared by several lines moves as one, so joined lines stay joined.
//  - Clicking such a stacked corner (Nodes mode) opens the Corner box: each line end gets a label
//    (L1, L2, ...) on the board and a checkbox, so only the checked ends are selected and move.
//  - With a single free end selected, only that one line changes.

import { bucket, checkpoint } from "../store.js";

const HIT_PX = 10;
const DRAG_PX = 3;
const SAME = 1e-6; // mm; points closer than this are the same corner

export function createSelectTool(env) {
    const selected = new Map(); // ref key -> ref
    let hover = null;
    let hoverHandle = null;
    let drag = null;
    let marker = null;
    let mode = "nodes";
    let splitHandles = true; // midpoint handles on selected lines (Actions menu toggle)
    let process = null; // guided Move: { step: "base" | "target", base, point }
    let lastCount = 0;
    let stack = null; // stacked corner being inspected: { ends: [{ geo, item, key, label }] }
    const geometries = env.selectionGeometries ?? env.geometries;

    const keyOf = (geo, item, key) => `${geo.bucket}:${item.id}:${key}`;
    const refKey = r => keyOf(r.geo, r.item, r.key);

    function allPoints() {
        const out = [];
        for (const geo of geometries) {
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
        for (const geo of geometries) {
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
        for (const geo of geometries) {
            if (geo.annotation) continue;
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

    function findTarget(sx, sy) {
        if (mode === "nodes") return findNode(sx, sy);
        const line = findLine(sx, sy);
        if (line) return line;
        const node = findNode(sx, sy);
        return node?.refs.some(r => r.geo.annotation) ? node : null;
    }

    // Lines that can be split by their midpoint handle: Lines mode, both ends selected, geometry supports it.
    function* splittable() {
        if (mode !== "lines" || !splitHandles) return;
        for (const geo of env.geometries) {
            if (!geo.split) continue;
            for (const item of bucket(geo.bucket).items) {
                const points = geo.points(item);
                if (points.length !== 2 || !points.every(p => selected.has(keyOf(geo, item, p.key)))) continue;
                const [a, b] = points;
                if (Math.abs(a.x - b.x) < SAME && Math.abs(a.y - b.y) < SAME) continue;
                yield { geo, item, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            }
        }
    }

    function findHandle(sx, sy) {
        let best = null, bestDist = HIT_PX;
        for (const h of splittable()) {
            const s = env.toScreen(h.x, h.y);
            const dist = Math.hypot(s.x - sx, s.y - sy);
            if (dist <= bestDist) { best = h; bestDist = dist; }
        }
        return best;
    }

    function updateHover(sx, sy) {
        hoverHandle = findHandle(sx, sy);
        hover = hoverHandle ? null : findTarget(sx, sy);
    }

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

    const pointOf = r => r.geo.points(r.item).find(q => q.key === r.key);
    const signed = v => (v < 0 ? "−" : "") + env.formatLength(Math.abs(v));

    // The far end of a two-point line, or null for other geometry.
    function otherEnd(r) {
        const points = r.geo.points(r.item);
        return points.length === 2 ? points.find(q => q.key !== r.key) : null;
    }

    function setStack(node, shared = true) {
        let line = 0;
        const next = node && (mode === "nodes" || node.refs.some(r => r.geo.annotation)) && node.refs.length >= 2
            ? { shared, ends: node.refs.map(r => ({
                geo: r.geo, item: r.item, key: r.key,
                label: r.geo.annotation ? `Area ${r.item.id} · P${Number(r.key.slice(1)) + 1}` : `L${++line}`
            })) }
            : null;
        if (!stack && !next) return;
        stack = next;
        publishStack();
    }

    // Tells the UI about the stacked corner; closes it once its ends no longer meet (e.g. some were moved away).
    function publishStack() {
        if (stack?.shared) {
            const points = stack.ends.map(pointOf);
            const [c] = points;
            if (points.some(p => !p || Math.abs(p.x - c.x) >= SAME || Math.abs(p.y - c.y) >= SAME)) stack = null;
        }
        if (!stack) {
            env.stackChanged?.(null);
            return;
        }
        const c = pointOf(stack.ends[0]);
        env.stackChanged?.({
            x: signed(c.x),
            y: signed(c.y),
            shared: stack.shared,
            ends: stack.ends.map(r => {
                const o = otherEnd(r);
                return {
                    label: r.label,
                    selected: selected.has(refKey(r)),
                    length: o ? env.formatLength(Math.hypot(o.x - c.x, o.y - c.y)) : null,
                    to: r.geo.annotation ? `${signed(pointOf(r).x)}, ${signed(pointOf(r).y)}`
                        : o ? `${signed(o.x)}, ${signed(o.y)}` : null,
                    ...(r.geo.annotation ? { area: true } : {})
                };
            })
        });
    }

    function drawStackLabels(g, view) {
        const d = view.dpr;
        g.font = `600 ${11 * d}px system-ui, -apple-system, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        for (const r of stack.ends) {
            const c = pointOf(r);
            const cs = view.toScreen(c.x, c.y);
            const o = otherEnd(r);
            const os = o && !r.geo.annotation ? view.toScreen(o.x, o.y) : { x: cs.x + 20, y: cs.y };
            const len = Math.hypot(os.x - cs.x, os.y - cs.y);
            if (len < 1) continue;
            const ux = (os.x - cs.x) / len, uy = (os.y - cs.y) / len;
            const reach = Math.min(36, len * 0.6);
            const on = selected.has(refKey(r));
            if (on && !r.geo.annotation) {
                g.strokeStyle = (view.paper ? "#000" : "#ff8fe0");
                g.lineWidth = 3 * d;
                g.beginPath();
                g.moveTo(cs.x * d, cs.y * d);
                g.lineTo((cs.x + ux * reach) * d, (cs.y + uy * reach) * d);
                g.stroke();
            }
            // Sit just above the line (screen up), part-way along it from the corner.
            let nx = -uy, ny = ux;
            if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny; }
            const x = (cs.x + ux * reach + nx * 11) * d, y = (cs.y + uy * reach + ny * 11) * d;
            const w = g.measureText(r.label).width + 10 * d, h = 16 * d;
            const color = r.geo.annotation ? (view.paper ? "#000" : "#8fe3ff") : (view.paper ? "#000" : "#ff8fe0");
            g.fillStyle = on ? color : (view.paper ? "rgba(255,255,255,0.95)" : "rgba(20,16,44,0.85)");
            g.strokeStyle = on ? color : (view.paper ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.5)");
            g.lineWidth = 1 * d;
            g.beginPath();
            g.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
            g.fill();
            g.stroke();
            g.fillStyle = on ? (view.paper ? "#fff" : "#1a1538") : (view.paper ? "rgba(0,0,0,0.8)" : "rgba(255,255,255,0.8)");
            g.fillText(r.label, x, y);
        }
        g.textAlign = "start";
        g.textBaseline = "alphabetic";
        g.lineWidth = 1.5 * d;
    }

    function report() {
        env.log("action", `selected ${selected.size} line end${selected.size === 1 ? "" : "s"}`);
        notifySelection();
    }

    function selectedMeasurementId() {
        const refs = [...selected.values()];
        const first = refs[0];
        return first?.geo.annotation &&
            refs.every(r => r.geo === first.geo && r.item === first.item) ? first.item.id : null;
    }

    function notifySelection() {
        env.measurementSelectionChanged?.(selectedMeasurementId());
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
        g.strokeStyle = (view.paper ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.85)");
        g.beginPath();
        g.moveTo(a.x * d, a.y * d);
        g.lineTo(s.x * d, s.y * d);
        g.stroke();
        g.setLineDash([]);

        const offset = Math.hypot(to.x - from.x, to.y - from.y);
        g.font = `${12 * d}px system-ui, -apple-system, sans-serif`;
        g.fillStyle = (view.paper ? "#000" : "#fff");
        g.shadowColor = (view.paper ? "transparent" : "rgba(0,0,0,0.8)");
        g.shadowBlur = view.fx ? 4 * d : 0;
        g.fillText(`Offset ${env.formatLength(offset)}`, (a.x + s.x) / 2 * d + 8 * d, (a.y + s.y) / 2 * d - 8 * d);
        g.shadowBlur = 0;
    }

    function drawSnapMarker(g, view, p) {
        const d = view.dpr;
        const s = view.toScreen(p.x, p.y);
        const r = (p.kind === "end" ? 8 : 6) * d;
        g.strokeStyle = p.kind === "end" ? (view.paper ? "#000" : "#ff8fe0") : (view.paper ? "rgba(0,0,0,0.8)" : "rgba(255,255,255,0.8)");
        g.strokeRect(s.x * d - r, s.y * d - r, r * 2, r * 2);
    }

    // The selection as it would look after moving by (dx, dy); lines with one selected end stretch.
    function drawMovePreview(g, view, dx, dy) {
        const d = view.dpr;
        g.beginPath();
        for (const geo of geometries) {
            for (const item of bucket(geo.bucket).items) {
                const points = geo.points(item);
                if (points.length < 2 || !points.some(p => selected.has(keyOf(geo, item, p.key)))) continue;
                const screen = points.map(p => {
                    const moved = selected.has(keyOf(geo, item, p.key));
                    return view.toScreen(p.x + (moved ? dx : 0), p.y + (moved ? dy : 0));
                });
                screen.forEach((p, i) => i ? g.lineTo(p.x * d, p.y * d) : g.moveTo(p.x * d, p.y * d));
                if (geo.annotation && screen.length >= 3) g.closePath();
            }
        }
        g.setLineDash([4 * d, 4 * d]);
        g.strokeStyle = (view.paper ? "rgba(0,0,0,0.6)" : "rgba(255,143,224,0.6)");
        g.lineWidth = 2 * d;
        g.stroke();
        g.setLineDash([]);
        g.lineWidth = 1.5 * d;
    }

    return {
        id: "select",
        hotkey: "s",

        selectedMeasurementId,

        canOpenMeasurement() {
            return !process && !drag;
        },

        startMove() {
            if (!selected.size) return false;
            drag = null;
            hover = null;
            hoverHandle = null;
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

        // Esc: cancel a running Move, otherwise close the Corner box (the selection stays).
        cancel() {
            if (this.cancelProcess()) return true;
            if (!stack) return false;
            setStack(null);
            env.redraw();
            return true;
        },

        closeStack() {
            if (!stack) return false;
            setStack(null);
            env.redraw();
            return true;
        },

        toggleStackEnd(index) {
            const r = stack?.ends[index];
            if (!r) return false;
            const k = refKey(r);
            if (selected.has(k)) selected.delete(k);
            else selected.set(k, { geo: r.geo, item: r.item, key: r.key });
            env.log("action", `${r.label} ${selected.has(k) ? "selected" : "deselected"}`);
            notifySelection();
            publishStack();
            env.redraw();
            return true;
        },

        // Undo first cancels a running Move, the next ones undo drawing edits.
        undoStep() {
            return this.cancelProcess();
        },

        setSelectionMode(value) {
            if (value !== "nodes" && value !== "lines") throw new Error(`Unknown selection mode: ${value}`);
            mode = value;
            setStack(null);
            hover = null;
            hoverHandle = null;
            drag = null;
            marker = null;
            env.redraw();
        },

        setSplitHandles(on) {
            splitHandles = !!on;
            hoverHandle = null;
            env.redraw();
        },

        deactivate() {
            selected.clear();
            setStack(null);
            hover = null;
            hoverHandle = null;
            drag = null;
            marker = null;
            if (process) setProcess(null);
            notifySelection();
        },

        // Undo replaces the stored items, so any selection would point at stale data.
        dataChanged() {
            selected.clear();
            stack = null;
            env.stackChanged?.(null);
            drag = null;
            hover = null;
            hoverHandle = null;
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
                publishStack();
                notifySelection();
                return;
            }
            const handle = !e.shift && findHandle(e.sx, e.sy);
            if (handle) {
                // The split happens once the drag really starts, so a plain click changes nothing.
                drag = {
                    kind: "move",
                    split: handle,
                    anchor: { x: handle.x, y: handle.y },
                    sx: e.sx,
                    sy: e.sy,
                    origin: new Map(),
                    moved: false,
                    toggleOnRelease: null
                };
                hover = null;
                env.capture(e.pointerId);
                env.redraw();
                return;
            }
            const node = findTarget(e.sx, e.sy);
            if (!node) {
                setStack(null);
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
                setStack(null);
                report();
                env.redraw();
                return;
            }

            // Grabbing the inspected corner keeps the ends picked in the Corner box.
            const inStack = stack && node.refs.some(r => stack.ends.some(s => refKey(s) === refKey(r)));
            const alreadySelected = isSelected(node) || (inStack && node.refs.some(r => selected.has(refKey(r))));
            if (!alreadySelected) {
                if (!e.shift) selected.clear();
                addNode(node);
                if ([...selected.values()].some(r => r.geo.annotation)) {
                    const refs = [...selected.values()];
                    setStack({ refs }, !e.shift);
                } else {
                    setStack(e.shift ? null : node);
                }
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
                updateHover(e.sx, e.sy);
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
                if (drag.split) {
                    const { geo, item, x, y } = drag.split;
                    const { added, joint } = geo.split(item, x, y);
                    // The new line's far end is the old corner, which was selected.
                    for (const p of geo.points(added)) selected.set(keyOf(geo, added, p.key), { geo, item: added, key: p.key });
                    for (const j of joint) drag.origin.set(keyOf(geo, j.item, j.key), { ref: { geo, item: j.item, key: j.key }, x, y });
                    hoverHandle = null;
                    notifySelection();
                    env.log("action", "split line");
                } else {
                    env.log("action", `drag ${selected.size} line end${selected.size === 1 ? "" : "s"}`);
                }
            }
            // Snap to grid or to ends that are not being moved.
            const p = env.snap(e.sx, e.sy, (geo, item, key) => drag.origin.has(keyOf(geo, item, key)));
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
                    const refs = [...selected.values()];
                    if (refs.some(r => r.geo.annotation)) setStack({ refs }, false);
                    report();
                } else if (!drag.shift && selected.size) {
                    selected.clear();
                    report();
                }
                drag = null;
                updateHover(e.sx, e.sy);
                env.redraw();
                return;
            }
            if (!drag.moved && drag.toggleOnRelease) {
                removeNode(drag.toggleOnRelease);
                report();
            }
            if (drag.moved || drag.toggleOnRelease) {
                publishStack();
                notifySelection();
            }
            drag = null;
            marker = null;
            updateHover(e.sx, e.sy);
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
            hoverHandle = null;
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
                g.strokeStyle = (view.paper ? "#000" : "#ff8fe0");
                g.shadowColor = (view.paper ? "transparent" : "rgba(255,143,224,0.8)");
                g.shadowBlur = view.fx && count <= 400 ? 8 * d : 0;
                g.stroke();
                g.shadowBlur = 0;
            }
            g.lineWidth = 1.5 * d;

            if (mode === "lines" && hover?.points && !drag && !isSelected(hover)) {
                const [a, b] = hover.points.map(p => view.toScreen(p.x, p.y));
                g.beginPath();
                g.moveTo(a.x * d, a.y * d);
                g.lineTo(b.x * d, b.y * d);
                g.strokeStyle = (view.paper ? "#000" : "#8fe3ff");
                g.lineWidth = 3 * d;
                g.stroke();
                g.lineWidth = 1.5 * d;
            }

            // Only points on screen get a marker.
            for (const p of allPoints()) {
                const s = view.toScreen(p.x, p.y);
                if (s.x < -10 || s.x > view.width + 10 || s.y < -10 || s.y > view.height + 10) continue;
                if (p.geo.annotation) {
                    const on = selected.has(refKey(p));
                    g.beginPath();
                    g.arc(s.x * d, s.y * d, (on ? 6 : 3.5) * d, 0, Math.PI * 2);
                    g.fillStyle = on ? (view.paper ? "#000" : "#8fe3ff") : (view.paper ? "#666" : "#167aab");
                    g.fill();
                    g.strokeStyle = (view.paper ? "#000" : "#8fe3ff");
                    g.stroke();
                    continue;
                }
                if (selected.has(refKey(p))) {
                    const r = 4.5 * d;
                    g.fillStyle = (view.paper ? "#000" : "#ff8fe0");
                    g.shadowColor = (view.paper ? "transparent" : "rgba(255,143,224,0.8)");
                    g.shadowBlur = view.fx ? 8 * d : 0;
                    g.fillRect(s.x * d - r, s.y * d - r, r * 2, r * 2);
                    g.shadowBlur = 0;
                } else {
                    const r = 3 * d;
                    g.strokeStyle = (view.paper ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.55)");
                    g.strokeRect(s.x * d - r, s.y * d - r, r * 2, r * 2);
                }
            }

            // Midpoint handles on selected lines: drag one to split the line there.
            if (!drag && !process) {
                for (const h of splittable()) {
                    const s = view.toScreen(h.x, h.y);
                    if (s.x < -10 || s.x > view.width + 10 || s.y < -10 || s.y > view.height + 10) continue;
                    const hot = hoverHandle?.item === h.item && hoverHandle?.geo === h.geo;
                    const r = (hot ? 6 : 4.5) * d;
                    g.beginPath();
                    g.moveTo(s.x * d, s.y * d - r);
                    g.lineTo(s.x * d + r, s.y * d);
                    g.lineTo(s.x * d, s.y * d + r);
                    g.lineTo(s.x * d - r, s.y * d);
                    g.closePath();
                    g.fillStyle = hot ? (view.paper ? "#000" : "#8fe3ff") : (view.paper ? "#fff" : "#1a1538");
                    g.fill();
                    g.strokeStyle = (view.paper ? "#000" : "#8fe3ff");
                    g.lineWidth = 1.5 * d;
                    g.stroke();
                }
            }

            if (stack && !drag?.moved && !process) drawStackLabels(g, view);

            if (hover && !drag && mode === "nodes") {
                const s = view.toScreen(hover.x, hover.y);
                const r = 8 * d;
                g.strokeStyle = (view.paper ? "#000" : "#8fe3ff");
                g.shadowColor = (view.paper ? "transparent" : "rgba(111,208,255,0.9)");
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
                    g.strokeStyle = (view.paper ? "#000" : "#8fe3ff");
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
                g.fillStyle = (view.paper ? "rgba(0,0,0,0.08)" : "rgba(143,227,255,0.12)");
                g.fillRect(left, top, width, height);
                g.strokeStyle = (view.paper ? "rgba(0,0,0,0.9)" : "rgba(143,227,255,0.9)");
                g.setLineDash([5 * d, 4 * d]);
                g.strokeRect(left, top, width, height);
                g.setLineDash([]);
            }
        }
    };
}

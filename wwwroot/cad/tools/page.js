// Page tool: places and edits print page frames (see ../pages.js).
//  - "Add page" (side panel) shows a dashed frame under the cursor; click to place it.
//  - Click a visible frame to select it, drag to move it. Click empty space to clear the selection.
//  - The selected page's information box edits a draft (name, paper, orientation, scale) that previews
//    live on the board; Save stores it (undoable), Cancel or Esc goes back to the stored page.
//  - With the Select tool, clicking a frame's border or label (where no line or corner is) switches here,
//    selects that page and starts dragging it.
//  - Print preview (selected page) switches to the Paper look and draws measurement text and label boxes
//    at the size they will print on that page, following the draft's scale and text size live.

import { bucket, checkpoint } from "../store.js";
import { PAGES, PAPERS, addPage, drawPages, isLocked, isVisible, nextPageName, pageRect, paperSize, paperOf, scaleLabel, validScale, MIN_SCALE, MAX_SCALE, textSizeOf, validTextSize, MIN_TEXT_SIZE, MAX_TEXT_SIZE } from "../pages.js";
import { COMPONENTS, componentAt, validComponent, drawPageComponents } from "../page-components.js";

const HIT_PX = 6;
const MAX_NAME = 60;
const FIT = 0.5; // a new first page covers about half the view

const DRAFT_FIELDS = ["name", "paper", "landscape", "scale", "textSize", ...COMPONENTS];
const pick = page => structuredClone(Object.fromEntries(DRAFT_FIELDS.map(f =>
    [f, f === "textSize" ? textSizeOf(page) : COMPONENTS.includes(f) ? page[f] ?? null : page[f]])));

// Largest 1-2-5 value (x 10^n) that is <= v.
function niceAtMost(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [5, 2, 1]) if (m * p <= v) return m * p;
    return p;
}

export function createPageTool(env) {
    let selectedId = null;
    let draft = null;
    let placing = false;
    let hover = null;
    let drag = null;
    let template = null; // paper, orientation and scale for the next new page
    let revision = 0; // bumps whenever the draft is reset from the stored page, so inputs know to reload
    let preview = false; // print preview of the selected page
    let labels = []; // label boxes from the last drawSaved, in CSS px
    let componentPlacement = null;

    const items = () => bucket(PAGES).items;
    const find = id => items().find(p => p.id === id) ?? null;
    const selected = () => (selectedId === null ? null : find(selectedId));
    // The selected page as drawn: stored position with the draft's paper, orientation and scale.
    const shown = page => (page.id === selectedId && draft ? { ...page, ...draft } : page);
    const dirty = () => {
        const page = selected();
        if (!page || !draft) return false;
        const stored = pick(page);
        return DRAFT_FIELDS.some(f => JSON.stringify(stored[f]) !== JSON.stringify(draft[f]));
    };
    const signed = v => (v < 0 ? "−" : "") + env.formatLength(Math.abs(v));

    function state() {
        const page = selected();
        let info = null;
        if (page && draft) {
            const view = { ...page, ...draft };
            const paper = paperSize(view);
            const rect = pageRect(view);
            info = {
                id: page.id, revision, name: draft.name, paper: draft.paper, landscape: !!draft.landscape, scale: draft.scale,
                textSize: draft.textSize, scaleLabel: scaleLabel(draft.scale),
                paperSize: `${+paper.w.toFixed(1)} × ${+paper.h.toFixed(1)} mm`,
                width: env.formatLength(rect.w), height: env.formatLength(rect.h),
                x: signed(page.x), y: signed(page.y), visible: isVisible(page), locked: isLocked(page),
                compass: draft.compass, ruler: draft.ruler
            };
        }
        return {
            pages: items().map(p => ({
                id: p.id, name: p.name, visible: isVisible(p), locked: isLocked(p), selected: p.id === selectedId,
                summary: `${paperOf(p.paper).label}${p.landscape ? " landscape" : ""} · ${scaleLabel(p.scale)}`
            })),
            selectedId: page ? page.id : null,
            placing,
            componentPlacement: componentPlacement ? `${componentPlacement.kind}${componentPlacement.anchor ? "-direction" : "-position"}` : null,
            preview: preview && !!page,
            dirty: dirty(),
            draft: info,
            papers: PAPERS.map(({ id, label, group }) => ({ id, label, group }))
        };
    }

    const emit = () => env.pagesChanged?.(state());
    const changed = () => { emit(); env.redraw(); };

    function select(id) {
        const page = id === null ? null : find(id);
        if (id !== null && !page) throw new Error(`Unknown page: ${id}`);
        selectedId = page ? page.id : null;
        componentPlacement = null;
        if (!page) preview = false;
        reset();
    }

    function reset() {
        const page = selected();
        draft = page ? pick(page) : null;
        revision++;
    }

    function hitTest(sx, sy) {
        const w = env.toWorld(sx, sy);
        const o = env.toWorld(0, 0), m = env.toWorld(HIT_PX, 0);
        const reach = Math.abs(m.x - o.x);
        const list = items();
        for (let i = list.length - 1; i >= 0; i--) {
            const page = list[i];
            if (!isVisible(page) || isLocked(page)) continue;
            const r = pageRect(shown(page));
            if (w.x >= r.left - reach && w.x <= r.right + reach && w.y >= r.bottom - reach && w.y <= r.top + reach) return page;
        }
        return null;
    }

    // Only the frame's border or its label, so a click inside a page still reaches the drawing (Select tool).
    function hitEdge(sx, sy) {
        const list = items();
        for (let i = list.length - 1; i >= 0; i--) {
            const page = list[i];
            if (!isVisible(page) || isLocked(page)) continue;
            const r = pageRect(shown(page));
            const a = env.toScreen(r.left, r.top), b = env.toScreen(r.right, r.bottom);
            const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
            const inX = sx >= x0 - HIT_PX && sx <= x1 + HIT_PX, inY = sy >= y0 - HIT_PX && sy <= y1 + HIT_PX;
            const nearX = Math.abs(sx - x0) <= HIT_PX || Math.abs(sx - x1) <= HIT_PX;
            const nearY = Math.abs(sy - y0) <= HIT_PX || Math.abs(sy - y1) <= HIT_PX;
            if ((nearX && inY) || (nearY && inX)) return page;
            const l = labels.find(l => l.id === page.id);
            if (l && sx >= l.x && sx <= l.x + l.w && sy >= l.y && sy <= l.y + l.h) return page;
        }
        return null;
    }

    function grab(page, e) {
        if (page.id !== selectedId) { select(page.id); changed(); }
        drag = { page, grab: env.snap(e.sx, e.sy), x: page.x, y: page.y, moved: false };
        if (e.pointerId !== undefined) env.capture?.(e.pointerId);
    }

    // First page: A4 portrait at a 1-2-5 scale that covers about half of the view.
    function newTemplate() {
        if (template) return template;
        const paper = paperOf("A4");
        const view = env.viewSizeMm?.();
        let scale = 1;
        if (view) scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, niceAtMost(Math.min(view.w * FIT / paper.w, view.h * FIT / paper.h))));
        return { paper: paper.id, landscape: 0, scale };
    }

    function checkDraft(next) {
        if (typeof next.name !== "string") throw new Error("Page name must be text");
        if (next.name.length > MAX_NAME) throw new Error(`Page name can be at most ${MAX_NAME} characters`);
        paperOf(next.paper);
        if (!validScale(next.scale)) throw new Error(`Scale must be a number between ${MIN_SCALE} and ${MAX_SCALE}`);
        if (!validTextSize(next.textSize)) throw new Error(`Text size must be between ${MIN_TEXT_SIZE}% and ${MAX_TEXT_SIZE}%`);
        for (const kind of COMPONENTS) {
            if (!validComponent(next[kind])) throw new Error(`${kind} must have finite paper coordinates, an angle and a size between 25% and 400%`);
        }
    }

    return {
        id: "page",
        hotkey: "p",

        state,
        refresh: emit,
        selectedId: () => selectedId,

        startComponent(kind) {
            if (!COMPONENTS.includes(kind)) throw new Error(`Unknown page component: ${kind}`);
            const page = selected();
            if (!page || !isVisible(page) || isLocked(page)) throw new Error("Select a visible, selectable page to place components");
            drag = null;
            componentPlacement = { kind, anchor: null, hover: null };
            changed();
        },

        setPreview(on) {
            if (on && !selected()) throw new Error("Select a page to preview it");
            preview = !!on;
            env.log("action", `page print preview ${preview ? "on" : "off"}`);
            changed();
        },

        // The page being previewed, with its draft applied, or null.
        previewPage() {
            const page = selected();
            return preview && page ? shown(page) : null;
        },

        deactivate() {
            placing = false;
            hover = null;
            drag = null;
            select(null);
            emit();
        },

        dataChanged() {
            drag = null;
            componentPlacement = null;
            if (selectedId !== null && !find(selectedId)) select(null);
            else if (selectedId !== null) reset();
            emit();
        },

        startPlacing() {
            select(null);
            placing = true;
            hover = null;
            env.log("action", "page: click to place");
            changed();
        },

        cancel() {
            if (componentPlacement) {
                componentPlacement = null;
            } else if (placing) {
                placing = false;
                hover = null;
            } else if (dirty()) {
                reset();
            } else if (selectedId !== null) {
                select(null);
            } else {
                return false;
            }
            changed();
            return true;
        },

        // First undo drops an unsaved edit or the frame being placed; the next ones undo stored changes.
        undoStep() {
            if (!placing && !componentPlacement && !dirty()) return false;
            this.cancel();
            return true;
        },

        select(id) {
            placing = false;
            hover = null;
            select(id);
            changed();
        },

        setDraft(changes) {
            if (!draft) throw new Error("Select a page before editing it");
            const next = { ...draft };
            for (const [key, value] of Object.entries(changes ?? {})) {
                if (!DRAFT_FIELDS.includes(key)) throw new Error(`Unknown page setting: ${key}`);
                next[key] = key === "landscape" ? (value ? 1 : 0) : structuredClone(value);
            }
            checkDraft(next);
            draft = next;
            changed();
        },

        save() {
            const page = selected();
            if (!page || !draft) throw new Error("Select a page before saving it");
            if (componentPlacement) throw new Error("Finish placing the component or cancel placement before saving");
            const name = draft.name.trim();
            if (!name) throw new Error("Give the page a name before saving");
            const next = { ...draft, name };
            checkDraft(next);
            checkpoint();
            Object.assign(page, next);
            reset();
            template = { paper: page.paper, landscape: page.landscape, scale: page.scale, textSize: textSizeOf(page) };
            env.log("action", `page saved: ${page.name}`);
            changed();
        },

        setVisible(id, on) {
            const page = find(id);
            if (!page) throw new Error(`Unknown page: ${id}`);
            if (isVisible(page) === !!on) return;
            checkpoint();
            page.visible = on ? 1 : 0;
            if (!on && selectedId === id) componentPlacement = null;
            changed();
        },

        setLocked(id, on) {
            const page = find(id);
            if (!page) throw new Error(`Unknown page: ${id}`);
            if (isLocked(page) === !!on) return;
            checkpoint();
            page.locked = on ? 1 : 0;
            if (on && drag?.page === page) drag = null;
            if (on && selectedId === id) componentPlacement = null;
            changed();
        },

        deletePage(id) {
            const page = find(id);
            if (!page) throw new Error(`Unknown page: ${id}`);
            checkpoint();
            bucket(PAGES).items = items().filter(p => p !== page);
            if (selectedId === id) select(null);
            env.log("action", `page deleted: ${page.name}`);
            changed();
        },

        // World rectangle of a page (with the draft applied), for zooming the view to it.
        rectOf(id) {
            const page = find(id);
            if (!page) throw new Error(`Unknown page: ${id}`);
            return pageRect(shown(page));
        },

        pointerDown(e) {
            if (componentPlacement) {
                const page = shown(selected());
                const p = env.snap(e.sx, e.sy);
                const placement = componentPlacement;
                if (!placement.anchor) {
                    const r = pageRect(page);
                    if (p.x < r.left || p.x > r.right || p.y < r.bottom || p.y > r.top) {
                        env.log("action", "Place the component inside the selected page");
                        return;
                    }
                    if (placement.kind === "compass") {
                        placement.anchor = p;
                        placement.hover = p;
                        changed();
                        return;
                    }
                }
                const anchor = placement.anchor ?? p;
                if (placement.anchor && p.x === anchor.x && p.y === anchor.y) {
                    env.log("action", "Click away from the compass centre to set north");
                    return;
                }
                const angle = placement.anchor ? Math.atan2(p.y - anchor.y, p.x - anchor.x) - Math.PI / 2 : 0;
                draft[placement.kind] = componentAt(page, anchor, draft[placement.kind]?.size ?? 100, angle);
                componentPlacement = null;
                changed();
                return;
            }
            if (placing) {
                const p = env.snap(e.sx, e.sy);
                const t = newTemplate();
                checkpoint();
                const page = addPage({ name: nextPageName(), ...t, x: p.x, y: p.y });
                template = { paper: page.paper, landscape: page.landscape, scale: page.scale, textSize: textSizeOf(page) };
                placing = false;
                hover = null;
                select(page.id);
                env.log("action", `page placed: ${page.name}`);
                changed();
                return;
            }
            const page = hitTest(e.sx, e.sy);
            if (!page) {
                if (selectedId !== null) { select(null); changed(); }
                return;
            }
            grab(page, e);
        },

        // Select tool: the page whose border or label is at the point (CSS px), or null.
        edgeAt(sx, sy) {
            return hitEdge(sx, sy)?.id ?? null;
        },

        // Selects the page and starts dragging it, as if it had been clicked with this tool.
        grab(id, e) {
            const page = find(id);
            if (!page) throw new Error(`Unknown page: ${id}`);
            grab(page, e);
        },

        pointerMove(e) {
            if (componentPlacement) {
                componentPlacement.hover = env.snap(e.sx, e.sy);
                env.redraw();
                return;
            }
            if (placing) {
                hover = env.snap(e.sx, e.sy);
                env.redraw();
                return;
            }
            if (!drag) return;
            const p = env.snap(e.sx, e.sy);
            const dx = p.x - drag.grab.x, dy = p.y - drag.grab.y;
            if (!drag.moved) {
                if (dx === 0 && dy === 0) return;
                checkpoint();
                drag.moved = true;
            }
            drag.page.x = drag.x + dx;
            drag.page.y = drag.y + dy;
            env.redraw();
        },

        pointerUp() {
            if (drag?.moved) {
                env.log("action", `page moved: ${drag.page.name}`);
                emit();
            }
            drag = null;
        },

        pointerLeave() {
            if (componentPlacement) {
                componentPlacement.hover = null;
                env.redraw();
            }
            if (!placing || !hover) return;
            hover = null;
            env.redraw();
        },

        // Stored frames, drawn under the drawing with any tool. A hidden page still shows dashed while selected.
        drawSaved(g, view) {
            const list = items().filter(p => (isVisible(p) || p.id === selectedId)).map(shown);
            labels = [];
            drawPages(g, list, view, p => (p.id !== selectedId ? "normal" : isVisible(p) ? "selected" : "ghost"), labels);
        },

        drawComponents(g, view) {
            for (const stored of items()) {
                let page = shown(stored);
                const placement = stored.id === selectedId ? componentPlacement : null;
                if (placement?.hover) {
                    const anchor = placement.anchor ?? placement.hover;
                    const angle = placement.anchor
                        ? Math.atan2(placement.hover.y - anchor.y, placement.hover.x - anchor.x) - Math.PI / 2 : 0;
                    page = { ...page, [placement.kind]: componentAt(page, anchor, draft[placement.kind]?.size ?? 100, angle) };
                }
                drawPageComponents(g, page, view, env.formatLength);
            }
        },

        draw(g, view) {
            if (!placing || !hover) return;
            drawPages(g, [{ id: 0, name: nextPageName(), ...newTemplate(), x: hover.x, y: hover.y }], view, () => "ghost");
        }
    };
}

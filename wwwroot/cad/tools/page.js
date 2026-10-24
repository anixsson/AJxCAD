// Page tool: places and edits print page frames (see ../pages.js).
//  - "Add page" (side panel) shows a dashed frame under the cursor; click to place it.
//  - Click a visible frame to select it, drag to move it. Click empty space to clear the selection.
//  - The selected page's information box edits a draft (name, paper, orientation, scale) that previews
//    live on the board; Save stores it (undoable), Cancel or Esc goes back to the stored page.

import { bucket, checkpoint } from "../store.js";
import { PAGES, PAPERS, addPage, drawPages, isLocked, isVisible, nextPageName, pageRect, paperSize, paperOf, scaleLabel, validScale, MIN_SCALE, MAX_SCALE } from "../pages.js";

const HIT_PX = 6;
const MAX_NAME = 60;
const FIT = 0.5; // a new first page covers about half the view

const DRAFT_FIELDS = ["name", "paper", "landscape", "scale"];
const pick = page => Object.fromEntries(DRAFT_FIELDS.map(f => [f, page[f]]));

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

    const items = () => bucket(PAGES).items;
    const find = id => items().find(p => p.id === id) ?? null;
    const selected = () => (selectedId === null ? null : find(selectedId));
    // The selected page as drawn: stored position with the draft's paper, orientation and scale.
    const shown = page => (page.id === selectedId && draft ? { ...page, ...draft } : page);
    const dirty = () => {
        const page = selected();
        return !!page && !!draft && DRAFT_FIELDS.some(f => page[f] !== draft[f]);
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
                scaleLabel: scaleLabel(draft.scale),
                paperSize: `${+paper.w.toFixed(1)} × ${+paper.h.toFixed(1)} mm`,
                width: env.formatLength(rect.w), height: env.formatLength(rect.h),
                x: signed(page.x), y: signed(page.y), visible: isVisible(page), locked: isLocked(page)
            };
        }
        return {
            pages: items().map(p => ({
                id: p.id, name: p.name, visible: isVisible(p), locked: isLocked(p), selected: p.id === selectedId,
                summary: `${paperOf(p.paper).label}${p.landscape ? " landscape" : ""} · ${scaleLabel(p.scale)}`
            })),
            selectedId: page ? page.id : null,
            placing,
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
    }

    return {
        id: "page",
        hotkey: "p",

        state,
        selectedId: () => selectedId,

        deactivate() {
            placing = false;
            hover = null;
            drag = null;
            select(null);
            emit();
        },

        dataChanged() {
            drag = null;
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
            if (placing) {
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
            if (!placing && !dirty()) return false;
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
                next[key] = key === "landscape" ? (value ? 1 : 0) : value;
            }
            checkDraft(next);
            draft = next;
            changed();
        },

        save() {
            const page = selected();
            if (!page || !draft) throw new Error("Select a page before saving it");
            const name = draft.name.trim();
            if (!name) throw new Error("Give the page a name before saving");
            const next = { ...draft, name };
            checkDraft(next);
            checkpoint();
            Object.assign(page, next);
            reset();
            template = { paper: page.paper, landscape: page.landscape, scale: page.scale };
            env.log("action", `page saved: ${page.name}`);
            changed();
        },

        setVisible(id, on) {
            const page = find(id);
            if (!page) throw new Error(`Unknown page: ${id}`);
            if (isVisible(page) === !!on) return;
            checkpoint();
            page.visible = on ? 1 : 0;
            changed();
        },

        setLocked(id, on) {
            const page = find(id);
            if (!page) throw new Error(`Unknown page: ${id}`);
            if (isLocked(page) === !!on) return;
            checkpoint();
            page.locked = on ? 1 : 0;
            if (on && drag?.page === page) drag = null;
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
            if (placing) {
                const p = env.snap(e.sx, e.sy);
                const t = newTemplate();
                checkpoint();
                const page = addPage({ name: nextPageName(), ...t, x: p.x, y: p.y });
                template = { paper: page.paper, landscape: page.landscape, scale: page.scale };
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
            if (page.id !== selectedId) { select(page.id); changed(); }
            const grab = env.snap(e.sx, e.sy);
            drag = { page, grab, x: page.x, y: page.y, moved: false };
            if (e.pointerId !== undefined) env.capture?.(e.pointerId);
        },

        pointerMove(e) {
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
            if (!placing || !hover) return;
            hover = null;
            env.redraw();
        },

        // Stored frames, drawn under the drawing with any tool. A hidden page still shows dashed while selected.
        drawSaved(g, view) {
            const list = items().filter(p => isVisible(p) || p.id === selectedId).map(shown);
            drawPages(g, list, view, p => (p.id !== selectedId ? "normal" : isVisible(p) ? "selected" : "ghost"));
        },

        draw(g, view) {
            if (!placing || !hover) return;
            drawPages(g, [{ id: 0, name: nextPageName(), ...newTemplate(), x: hover.x, y: hover.y }], view, () => "ghost");
        }
    };
}

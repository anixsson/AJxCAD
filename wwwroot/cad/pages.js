// The "pages" data bucket: print page frames placed on the board.
// A page is a sheet of paper (ISO or US size, portrait or landscape) scaled by `scale`:
// the frame covers paper size × scale of the drawing, so scale 50 prints at 1:50.
// x/y is the frame centre in world mm, so changing paper or scale grows the frame around its middle.

import { bucket, defineBucket, newId } from "./store.js";

export const PAGES = "pages";

defineBucket(PAGES, { label: "Pages", fields: ["id", "name", "paper", "landscape", "scale", "x", "y", "visible", "locked", "textSize"] });

// Portrait width × height in mm.
export const PAPERS = [
    { id: "A5", label: "A5", group: "ISO", w: 148, h: 210 },
    { id: "A4", label: "A4", group: "ISO", w: 210, h: 297 },
    { id: "A3", label: "A3", group: "ISO", w: 297, h: 420 },
    { id: "A2", label: "A2", group: "ISO", w: 420, h: 594 },
    { id: "A1", label: "A1", group: "ISO", w: 594, h: 841 },
    { id: "A0", label: "A0", group: "ISO", w: 841, h: 1189 },
    { id: "Letter", label: "Letter", group: "US", w: 215.9, h: 279.4 },
    { id: "Legal", label: "Legal", group: "US", w: 215.9, h: 355.6 },
    { id: "Tabloid", label: "Tabloid", group: "US", w: 279.4, h: 431.8 },
    { id: "ANSI-C", label: "ANSI C", group: "US", w: 431.8, h: 558.8 },
    { id: "ANSI-D", label: "ANSI D", group: "US", w: 558.8, h: 863.6 }
];

export const MIN_SCALE = 0.01;
// Measurement text and label boxes in print, as a percentage of the normal print size.
export const MIN_TEXT_SIZE = 50;
export const MAX_TEXT_SIZE = 400;
export const textSizeOf = page => page.textSize ?? 100; // older files have no value
export const validTextSize = v => typeof v === "number" && Number.isFinite(v) && v >= MIN_TEXT_SIZE && v <= MAX_TEXT_SIZE;

export const MAX_SCALE = 100000;

export function paperOf(id) {
    const paper = PAPERS.find(p => p.id === id);
    if (!paper) throw new Error(`Unknown paper size: ${id}`);
    return paper;
}

export function validScale(scale) {
    return typeof scale === "number" && Number.isFinite(scale) && scale >= MIN_SCALE && scale <= MAX_SCALE;
}

// Paper size in mm, after orientation.
export function paperSize(page) {
    const p = paperOf(page.paper);
    return page.landscape ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
}

// The frame on the board, in world mm (y up).
export function pageRect(page) {
    const { w, h } = paperSize(page);
    const fw = w * page.scale, fh = h * page.scale;
    return { left: page.x - fw / 2, right: page.x + fw / 2, bottom: page.y - fh / 2, top: page.y + fh / 2, w: fw, h: fh };
}

// "1:50" for scale 50, "2:1" for scale 0.5.
export function scaleLabel(scale) {
    const n = v => `${+v.toFixed(3)}`;
    return scale >= 1 ? `1:${n(scale)}` : `${n(1 / scale)}:1`;
}

export const isVisible = page => page.visible !== 0 && page.visible !== false;
// "No select": the frame cannot be clicked or dragged on the board (older files have no value: selectable).
export const isLocked = page => page.locked === 1 || page.locked === true;

export function addPage({ name, paper = "A4", landscape = 0, scale = 1, x = 0, y = 0, visible = 1, locked = 0, textSize = 100 }) {
    paperOf(paper);
    if (!validScale(scale)) throw new Error(`Page scale must be between ${MIN_SCALE} and ${MAX_SCALE}`);
    if (!validTextSize(textSize)) throw new Error(`Text size must be between ${MIN_TEXT_SIZE}% and ${MAX_TEXT_SIZE}%`);
    const items = bucket(PAGES).items;
    const page = { id: newId(), name: name ?? nextPageName(), paper, landscape: landscape ? 1 : 0, scale, x, y, visible: visible ? 1 : 0, locked: locked ? 1 : 0, textSize };
    items.push(page);
    return page;
}

// "Page N" with the lowest N not already used.
export function nextPageName() {
    const used = new Set(bucket(PAGES).items.map(p => p.name));
    let n = 1;
    while (used.has(`Page ${n}`)) n++;
    return `Page ${n}`;
}

// Draws page frames with their name and scale above the top-left corner.
// `style(page)` returns "normal", "selected" or "ghost".
export function drawPages(g, pages, view, style = () => "normal") {
    const d = view.dpr;
    const ink = view.paper ? "0,0,0" : "150,255,190";
    g.font = `${11 * d}px system-ui, -apple-system, sans-serif`;
    g.textBaseline = "bottom";
    for (const page of pages) {
        const kind = style(page);
        const r = pageRect(page);
        const a = view.toScreen(r.left, r.top), b = view.toScreen(r.right, r.bottom);
        const x = Math.round(a.x * d), y = Math.round(a.y * d);
        const w = Math.round(b.x * d) - x, h = Math.round(b.y * d) - y;
        if (x > view.width * d || y > view.height * d || x + w < 0 || y + h < 0) continue;

        if (kind !== "ghost") {
            g.fillStyle = `rgba(${ink},${kind === "selected" ? 0.07 : 0.035})`;
            g.fillRect(x, y, w, h);
        }
        g.setLineDash(kind === "ghost" ? [6 * d, 5 * d] : []);
        g.lineWidth = (kind === "selected" ? 2 : 1.25) * d;
        g.strokeStyle = `rgba(${ink},${kind === "normal" ? (view.paper ? 0.55 : 0.6) : 0.95})`;
        if (view.fx && !view.paper && kind === "selected") {
            g.shadowColor = "rgba(150,255,190,0.5)";
            g.shadowBlur = 6 * d;
        }
        g.strokeRect(x + 0.5, y + 0.5, w, h);
        g.shadowBlur = 0;
        g.setLineDash([]);

        if (kind === "selected") {
            g.fillStyle = `rgb(${ink})`;
            const s = 3 * d;
            for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) g.fillRect(cx - s, cy - s, s * 2, s * 2);
        }

        g.fillStyle = `rgba(${ink},${kind === "normal" ? 0.75 : 1})`;
        const paper = paperOf(page.paper);
        g.fillText(`${page.name} · ${paper.label}${page.landscape ? " landscape" : ""} · ${scaleLabel(page.scale)}`, x, y - 4 * d);
    }
    g.textBaseline = "alphabetic";
}

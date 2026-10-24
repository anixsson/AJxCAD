import { bucket, defineBucket, checkpoint, newId } from "./store.js";
import { activeLayerId } from "./layers.js";
import { drawSnapIndicator } from "./snap-indicator.js";

export const TEXTS = "texts";
defineBucket(TEXTS, { label: "Text", fields: ["id", "text", "x", "y", "fontSize", "fontFamily", "bold", "italic", "underline", "layerId"] });
const DEFAULT_STYLE = Object.freeze({ fontSize: 4.5, fontFamily: "sans-serif", bold: false, italic: false, underline: false });
let previewItem = null;

function validatedText(text) {
    if (typeof text !== "string" || !text.trim()) throw new Error("Text cannot be empty");
    const value = text.trim();
    if (value.length > 240) throw new Error("Text cannot exceed 240 characters");
    return value;
}

export function addText(text, x, y, style = {}) {
    const item = {
        id: newId(), text: validatedText(text), x, y,
        fontSize: style.fontSize ?? DEFAULT_STYLE.fontSize,
        fontFamily: style.fontFamily ?? DEFAULT_STYLE.fontFamily,
        bold: style.bold ?? DEFAULT_STYLE.bold,
        italic: style.italic ?? DEFAULT_STYLE.italic,
        underline: style.underline ?? DEFAULT_STYLE.underline,
        layerId: activeLayerId()
    };
    bucket(TEXTS).items.push(item);
    return item;
}

const fontOf = item => `${item.italic ? "italic " : ""}${item.bold ? "bold " : ""}${(item.fontSize ?? DEFAULT_STYLE.fontSize)}px ${item.fontFamily ?? DEFAULT_STYLE.fontFamily}`;
function drawText(g, item, view, preview = false) {
    const d = view.dpr, p = view.toScreen(item.x, item.y), size = (item.fontSize ?? DEFAULT_STYLE.fontSize) * view.scale * d;
    g.font = fontOf(item).replace(`${item.fontSize ?? DEFAULT_STYLE.fontSize}px`, `${(item.fontSize ?? DEFAULT_STYLE.fontSize) * view.scale * d}px`);
    g.fillStyle = preview ? (view.paper ? "#000" : "#ff8fe0") : view.paper ? "#000" : "#fff";
    g.shadowColor = view.paper || preview ? "transparent" : "rgba(0,0,0,0.8)";
    g.shadowBlur = view.fx && !view.paper && !preview ? 4 * d : 0;
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.fillText(item.text, p.x * d, p.y * d);
    if (item.underline) {
        const width = g.measureText(item.text).width;
        g.beginPath();
        g.lineWidth = Math.max(d, size / 14);
        g.moveTo(p.x * d, p.y * d + size * 0.12);
        g.lineTo(p.x * d + width, p.y * d + size * 0.12);
        g.strokeStyle = g.fillStyle;
        g.stroke();
    }
}

export const textGeometry = {
    bucket: TEXTS,
    draw(g, items, view) {
        if (view.savedOnly) {
            for (const item of items) drawText(g, item, view);
            return;
        }
        let edited = null;
        for (const item of items) {
            if (item.id === previewItem?.id) edited = item;
            else drawText(g, item, view);
        }
        // The draft supplies the style; the stored item supplies the position, so Select can move it live.
        if (edited) drawText(g, { ...previewItem, x: edited.x, y: edited.y }, view, true);
        else if (previewItem?.mode === "place" && previewItem.text) drawText(g, previewItem, view, true);
    },
    points: item => [{ key: "anchor", x: item.x, y: item.y }],
    setPoint(item, key, x, y) {
        if (key !== "anchor") throw new Error(`Unknown text point: ${key}`);
        item.x = x;
        item.y = y;
    },
    drawMovePreview(g, view, item, selectedKeys, dx, dy) {
        const styled = item.id === previewItem?.id ? { ...previewItem } : item;
        drawText(g, { ...styled, x: item.x + (selectedKeys.has("anchor") ? dx : 0), y: item.y + (selectedKeys.has("anchor") ? dy : 0) }, view, true);
    },
    hitTest(item, sx, sy, env) {
        const p = env.toScreen(item.x, item.y);
        const width = item.text.length * (item.fontSize ?? DEFAULT_STYLE.fontSize) * 0.65;
        const height = item.fontSize ?? DEFAULT_STYLE.fontSize;
        const scale = env.scale();
        return sx >= p.x - 10 && sx <= p.x + width * scale + 10 && sy >= p.y - height * scale - 10 && sy <= p.y + 8 ? 0 : null;
    }
};

export function createTextTool(env) {
    let draft = null;
    let hover = null;
    const publish = () => {
        previewItem = draft ? { ...draft } : null;
        env.textChanged?.(draft ? { ...draft } : null);
        env.redraw();
    };
    const clear = () => { draft = null; previewItem = null; env.textChanged?.(null); env.redraw(); };

    return {
        id: "text",
        hotkey: "t",
        deactivate() {
            if (draft) clear();
            hover = null;
        },
        dataChanged() {
            this.cancel();
        },
        pointerDown(e) {
            const p = env.gridSnap(e.sx, e.sy);
            hover = p;
            draft = { mode: "place", x: p.x, y: p.y, text: "", ...DEFAULT_STYLE };
            publish();
        },
        pointerMove(e) {
            hover = draft?.mode === "edit" ? null : env.gridSnap(e.sx, e.sy);
            env.redraw();
        },
        pointerLeave() {
            hover = null;
            env.redraw();
        },
        open(id) {
            const item = bucket(TEXTS).items.find(entry => entry.id === id);
            if (!item) throw new Error(`Unknown text item: ${id}`);
            hover = null;
            if (draft?.mode === "edit" && draft.id === id) return;
            draft = { ...DEFAULT_STYLE, ...item, mode: "edit" };
            publish();
        },
        setDraft(value) {
            if (!draft) throw new Error("No text information box is open");
            if (typeof value.text !== "string") throw new Error("Text must be a string");
            if (value.text.length > 240) throw new Error("Text cannot exceed 240 characters");
            if (!Number.isFinite(value.fontSize) || value.fontSize < 1 || value.fontSize > 1000)
                throw new Error("Text font size must be from 1 to 1000 mm");
            if (!["sans-serif", "serif", "monospace"].includes(value.fontFamily))
                throw new Error("Unknown text font family");
            for (const key of ["bold", "italic", "underline"]) if (typeof value[key] !== "boolean")
                throw new Error(`Text ${key} must be a checkbox value`);
            Object.assign(draft, value);
            publish();
        },
        // Closes the information box when the text it edits no longer exists (e.g. deleted in Select).
        closeIfDeleted() {
            if (draft?.mode !== "edit" || bucket(TEXTS).items.some(item => item.id === draft.id)) return false;
            clear();
            return true;
        },
        cancel() {
            if (!draft) return false;
            clear();
            return true;
        },
        save() {
            if (!draft) throw new Error("No text information box is open");
            const value = validatedText(draft.text);
            if (draft.mode === "place") {
                checkpoint();
                const item = addText(value, draft.x, draft.y, draft);
                draft = { ...DEFAULT_STYLE, ...item, mode: "edit" };
                publish();
                env.log("action", "text placed");
                return;
            }
            const item = bucket(TEXTS).items.find(entry => entry.id === draft.id);
            if (!item) throw new Error(`Text item ${draft.id} no longer exists`);
            checkpoint();
            Object.assign(item, { text: value, fontSize: draft.fontSize, fontFamily: draft.fontFamily,
                bold: draft.bold, italic: draft.italic, underline: draft.underline });
            clear();
            env.log("action", "text updated");
        },
        draw(g, view) {
            drawSnapIndicator(g, view, draft?.mode === "place" ? { x: draft.x, y: draft.y } : hover);
        }
    };
}

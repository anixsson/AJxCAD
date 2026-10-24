import { bucket, defineBucket, checkpoint, newId, parseDataText } from "./store.js";
import { activeLayerId } from "./layers.js";
import { lineGeometry } from "./lines.js";
import { shapeGeometry } from "./shapes.js";
import { textGeometry } from "./text.js";
import { pointGeometry, markerVisible } from "./points.js";
import { createMeasurementTool, dimensionOf } from "./tools/measurement.js";
import { drawSnapIndicator } from "./snap-indicator.js";

export const SYMBOLS = "symbols";
defineBucket(SYMBOLS, {
    label: "Symbols", fields: ["id", "source", "x", "y", "scale", "layerId"]
});
const sources = new Map();
const requests = new WeakMap();
const sourceGeometries = [lineGeometry, shapeGeometry, textGeometry, pointGeometry];
const projectBuckets = new Set(["project", "layers", "pages"]);

export const clearSymbolSources = () => sources.clear();
export const symbolSourceState = item => sources.get(item.source) ?? { error: "Source project has not been loaded" };
export const symbolFormat = project => ({
    length: mm => project.imperial ? `${+(mm / 25.4).toFixed(3)} in` : `${+mm.toFixed(3)} mm`,
    area: mm => project.imperial ? `${+(mm / 645.16).toFixed(3)} in²` : `${+mm.toFixed(3)} mm²`
});

export function parseSymbolSource(text) {
    const doc = parseDataText(text);
    const rows = entry => entry.rows.map(row => Object.fromEntries(entry.fields.map((field, i) => [field, row[i]])));
    const layers = new Map(rows(doc.buckets.find(b => b.name === "layers") ?? { fields: [], rows: [] }).map(l => [l.id, l]));
    const project = rows(doc.buckets.find(b => b.name === "project") ?? { fields: [], rows: [] })[0] ?? {};
    // Tool buckets belong to this isolated source, never to the host store.
    const buckets = new Map(doc.buckets.filter(b => !projectBuckets.has(b.name)).map(b => [b.name, rows(b)]));
    const visible = item => {
        if (item.layerId == null) return true;
        const layer = layers.get(item.layerId);
        if (!layer) throw new Error(`Unknown source layer: ${item.layerId}`);
        return layer.visible !== false;
    };
    for (const items of buckets.values()) for (const item of items) visible(item);
    const validPoint = point => {
        if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) throw new Error("Invalid source geometry");
    };
    for (const geo of sourceGeometries) for (const item of buckets.get(geo.bucket) ?? []) {
        if (geo === shapeGeometry && !["circle", "rectangle"].includes(item.type)) throw new Error("Invalid source shape");
        if (geo === textGeometry && (typeof item.text !== "string" ||
            !Number.isFinite(item.fontSize ?? 4.5) || (item.fontSize ?? 4.5) <= 0)) throw new Error("Invalid source text");
        for (const point of geo.points(item)) validPoint(point);
    }
    for (const item of buckets.get("measures") ?? []) {
        if (!Array.isArray(item.points)) throw new Error("Invalid source measurement");
        for (const point of item.points) validPoint(point);
        if (item.dimension != null) validPoint(item.dimension);
    }
    return {
        buckets, project, visible, items: name => (buckets.get(name) ?? []).filter(visible),
        settings: { scale: project.pointScale ?? 100, visibility: project.pointVisibility ?? "local" }
    };
}

export function symbolBounds(item, ancestry = new Set()) {
    const state = symbolSourceState(item);
    if (!state.source || ancestry.has(item.source)) {
        return { left: item.x, right: item.x + 100 * item.scale, bottom: item.y - 60 * item.scale, top: item.y };
    }
    const next = new Set(ancestry).add(item.source);
    let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
    const include = (x, y) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Invalid source geometry");
        left = Math.min(left, x); right = Math.max(right, x);
        bottom = Math.min(bottom, y); top = Math.max(top, y);
    };
    const source = state.source;
    for (const geo of sourceGeometries) for (const entry of source.items(geo.bucket)) {
        if (geo === pointGeometry && !markerVisible(entry, source.settings)) continue;
        if (geo === shapeGeometry && entry.type === "circle") {
            const radius = Math.hypot(entry.x2 - entry.x1, entry.y2 - entry.y1);
            include(entry.x1 - radius, entry.y1 - radius); include(entry.x1 + radius, entry.y1 + radius);
        } else if (geo === textGeometry) {
            const size = entry.fontSize ?? 4.5;
            include(entry.x, entry.y - size * 0.3);
            include(entry.x + entry.text.length * size, entry.y + size * 1.2);
        } else for (const p of geo.points(entry)) include(p.x, p.y);
    }
    for (const entry of source.items("measures")) {
        const pts = entry.points.filter(p => p.enabled !== false);
        for (const p of pts) include(p.x, p.y);
        const dim = dimensionOf(pts, entry.dimension);
        if (dim) { include(dim.a2.x, dim.a2.y); include(dim.b2.x, dim.b2.y); }
    }
    for (const entry of source.items(SYMBOLS)) {
        const bounds = symbolBounds(entry, next);
        include(bounds.left, bounds.bottom); include(bounds.right, bounds.top);
    }
    if (!Number.isFinite(left)) { left = 0; right = 100; bottom = -60; top = 0; }
    return {
        left: item.x + left * item.scale, right: item.x + right * item.scale,
        bottom: item.y + bottom * item.scale, top: item.y + top * item.scale
    };
}

export async function loadSymbolSource(source, readSource, ancestry = new Set(), text = null) {
    if (ancestry.has(source)) throw new Error(`Circular symbol import: ${source}`);
    const result = text === null ? await readSource(source) : { text };
    if (result.error) throw new Error(result.error);
    const parsed = parseSymbolSource(result.text);
    const next = new Set(ancestry).add(source);
    for (const item of parsed.buckets.get(SYMBOLS) ?? []) {
        if (typeof item.source !== "string" || !item.source) throw new Error("Invalid nested symbol source");
        if (![item.x, item.y, item.scale].every(Number.isFinite) || item.scale <= 0)
            throw new Error("Invalid nested symbol transform");
        if (next.has(item.source)) throw new Error(`Circular symbol import: ${item.source}`);
        try {
            const child = await loadSymbolSource(item.source, readSource, next);
            sources.set(item.source, { source: child });
        } catch (error) {
            sources.set(item.source, { error: error.message });
        }
    }
    return parsed;
}

export async function prepareSymbolSource(source, text, readSource) {
    const parsed = await loadSymbolSource(source, readSource, new Set(), text);
    sources.set(source, { source: parsed });
}

export function addSymbol(source, x, y) {
    if (typeof source !== "string" || !source.trim()) throw new Error("Select a source project");
    if (![x, y].every(Number.isFinite)) throw new Error("Invalid symbol origin");
    checkpoint();
    const item = { id: newId(), source, x, y, scale: 1, layerId: activeLayerId() };
    bucket(SYMBOLS).items.push(item);
    return item;
}

function requireSymbol(id) {
    const item = bucket(SYMBOLS).items.find(item => item.id === id);
    if (!item) throw new Error(`Unknown symbol: ${id}`);
    return item;
}

export function setSymbolScale(id, scale) {
    if (!Number.isFinite(scale) || scale <= 0 || scale > 10000)
        throw new Error("Symbol scale must be greater than 0 and at most 10000");
    const item = requireSymbol(id);
    checkpoint();
    item.scale = scale;
}

export async function refreshSymbol(id, readSource, replacement = null, text = null) {
    const item = requireSymbol(id), source = replacement ?? item.source;
    const request = {};
    requests.set(item, request);
    const current = () => bucket(SYMBOLS).items.includes(item) && requests.get(item) === request;
    try {
        const parsed = await loadSymbolSource(source, readSource, new Set(), text);
        if (!current()) return;
        if (replacement !== null) { checkpoint(); item.source = source; }
        sources.set(source, { source: parsed });
    } catch (error) {
        if (!current()) return;
        if (replacement === null) sources.set(source, { error: error.message });
        throw error;
    }
}

export const symbolGeometry = {
    bucket: SYMBOLS,
    points: item => [{ key: "origin", x: item.x, y: item.y }],
    setPoint(item, key, x, y) {
        if (key !== "origin") throw new Error(`Unknown symbol handle: ${key}`);
        item.x = x; item.y = y;
    },
    hitTest(item, sx, sy, env) {
        const p = env.toWorld(sx, sy), r = symbolBounds(item), margin = 5 / env.scale();
        return p.x >= r.left - margin && p.x <= r.right + margin &&
            p.y <= r.top + margin && p.y >= r.bottom - margin ? 0 : null;
    },
    selectRect(item, rect, env) {
        const r = symbolBounds(item);
        const a = env.toScreen(r.left, r.top), b = env.toScreen(r.right, r.bottom);
        return a.x >= rect.left && b.x <= rect.right && a.y >= rect.top && b.y <= rect.bottom ? ["origin"] : [];
    },
    drawSelection(g, view, item) {
        const r = symbolBounds(item), a = view.toScreen(r.left, r.top), b = view.toScreen(r.right, r.bottom), d = view.dpr;
        g.save();
        g.shadowBlur = 0;
        g.setLineDash([5 * d, 4 * d]);
        g.strokeStyle = view.paper ? "#000" : "#ff8fe0";
        g.lineWidth = 1.5 * d;
        g.strokeRect(a.x * d - 4 * d, a.y * d - 4 * d, (b.x - a.x + 8) * d, (b.y - a.y + 8) * d);
        g.restore();
    },
    draw(g, items, view, ancestry = new Set()) {
        for (const item of items) {
            const state = symbolSourceState(item);
            g.save();
            if (!state.source || ancestry.has(item.source)) {
                const r = symbolBounds(item), a = view.toScreen(r.left, r.top), b = view.toScreen(r.right, r.bottom), d = view.dpr;
                g.shadowBlur = 0;
                g.strokeStyle = view.paper ? "#000" : "#ff8fe0";
                g.lineWidth = 2 * d;
                g.strokeRect(a.x * d, a.y * d, (b.x - a.x) * d, (b.y - a.y) * d);
                g.beginPath();
                g.moveTo(a.x * d, a.y * d); g.lineTo(b.x * d, b.y * d);
                g.moveTo(b.x * d, a.y * d); g.lineTo(a.x * d, b.y * d);
                g.stroke();
                g.fillStyle = view.paper ? "#000" : "#fff";
                g.font = `${12 * d}px sans-serif`;
                g.textAlign = "center";
                g.fillText("Missing symbol import", (a.x + b.x) / 2 * d, (a.y + b.y) / 2 * d);
            } else {
                const source = state.source;
                const sourceView = {
                    ...view, scale: view.scale * item.scale, savedOnly: true, sourceGroup: true,
                    pointSettings: source.settings,
                    pointPrintPx: (view.pointPrintPx || 1) * item.scale,
                    toScreen: (x, y) => view.toScreen(item.x + x * item.scale, item.y + y * item.scale)
                };
                for (const geo of sourceGeometries) geo.draw(g, source.items(geo.bucket), sourceView);
                this.draw(g, source.items(SYMBOLS), sourceView, new Set(ancestry).add(item.source));
                createMeasurementTool({ visibleItems: source.items,
                    formatLength: symbolFormat(source.project).length, formatArea: symbolFormat(source.project).area
                }).drawSaved(g, sourceView);
            }
            g.restore();
        }
    },
    drawMovePreview(g, view, item, keys, dx, dy) {
        this.draw(g, [{ ...item, x: item.x + dx, y: item.y + dy }], view);
    }
};

export function createSymbolTool(env) {
    let selectedId = null, pending = null, hover = null;
    const publish = () => {
        const item = bucket(SYMBOLS).items.find(item => item.id === selectedId);
        env.symbolChanged?.(item ? { id: item.id, source: item.source, scale: item.scale, error: symbolSourceState(item).error ?? null }
            : pending ? { id: null, source: pending, scale: 1, error: null } : null);
        env.redraw();
    };
    return {
        id: "symbol", hotkey: "i",
        prepare(source) { selectedId = null; pending = source; publish(); },
        inspect(id) { if (id === selectedId) return; selectedId = id; publish(); },
        refresh: publish,
        dataChanged() { selectedId = null; pending = null; hover = null; publish(); },
        deactivate() { this.dataChanged(); },
        cancel() {
            if (!pending && selectedId === null) return false;
            this.dataChanged(); return true;
        },
        pointerDown(e) {
            if (!pending) return;
            const p = env.gridSnap(e.sx, e.sy);
            const item = addSymbol(pending, p.x, p.y);
            pending = null;
            env.setTool("select");
            env.selectSymbol(item.id);
        },
        pointerMove(e) { hover = env.gridSnap(e.sx, e.sy); env.redraw(); },
        pointerLeave() { hover = null; env.redraw(); },
        draw(g, view) {
            if (!pending || !hover) return;
            g.save(); g.globalAlpha = 0.65;
            symbolGeometry.draw(g, [{ source: pending, ...hover, scale: 1 }], view);
            g.restore();
            drawSnapIndicator(g, view, hover);
        }
    };
}

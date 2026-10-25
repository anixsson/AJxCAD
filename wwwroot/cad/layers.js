import { bucket, defineBucket, describe, checkpoint, newId } from "./store.js";

export const LAYERS = "layers";
defineBucket(LAYERS, { label: "Layers", fields: ["id", "name", "visible", "printable"], group: "project" });
let activeId = null;

export function defaultLayer() {
    const items = bucket(LAYERS).items;
    if (!items.length) items.push({ id: newId(), name: "Layer 0", visible: true, printable: true });
    const layer = items[0];
    layer.name = "Layer 0";
    return layer;
}

export function activeLayerId() {
    const first = defaultLayer();
    if (!bucket(LAYERS).items.some(l => l.id === activeId)) activeId = first.id;
    return activeId;
}

export function requireLayer(id) {
    const layer = bucket(LAYERS).items.find(l => l.id === id);
    if (!layer) throw new Error(`Unknown layer: ${id}`);
    return layer;
}

export function setActiveLayer(id) {
    requireLayer(id);
    activeId = id;
}

export function layerState() {
    return { activeId: activeLayerId(), layers: structuredClone(bucket(LAYERS).items) };
}

export function addLayer() {
    defaultLayer();
    const items = bucket(LAYERS).items;
    let n = 1;
    while (items.some(l => l.name === `Layer ${n}`)) n++;
    checkpoint();
    const layer = { id: newId(), name: `Layer ${n}`, visible: true, printable: true };
    items.push(layer);
    activeId = layer.id;
}

export function updateLayer(id, changes) {
    const layer = requireLayer(id);
    for (const key of Object.keys(changes)) {
        if (!["name", "visible", "printable"].includes(key)) throw new Error(`Unknown layer setting: ${key}`);
    }
    if (layer.id === defaultLayer().id && "name" in changes)
        throw new Error("Layer 0 cannot be renamed");
    if ("name" in changes && (typeof changes.name !== "string" || !changes.name.trim()))
        throw new Error("Layer name cannot be empty");
    for (const key of ["visible", "printable"]) {
        if (key in changes && typeof changes[key] !== "boolean") throw new Error(`${key} must be a checkbox value`);
    }
    checkpoint();
    Object.assign(layer, changes, "name" in changes ? { name: changes.name.trim() } : {});
}

export function removeLayer(id) {
    const items = bucket(LAYERS).items;
    const base = defaultLayer();
    const layer = requireLayer(id);
    if (layer.id === base.id) throw new Error("Layer 0 cannot be removed");

    checkpoint();
    for (const entry of describe()) {
        const b = bucket(entry.name);
        if (!b.fields?.includes("layerId")) continue;
        for (const item of b.items) {
            if (item.layerId === id) item.layerId = base.id;
        }
    }
    items.splice(items.indexOf(layer), 1);
    if (activeId === id) activeId = base.id;
}

export function layerVisible(item) {
    if (item.layerId == null) return true;
    return requireLayer(item.layerId).visible !== false;
}

export function layerPrintable(item) {
    return layerVisible(item) && (item.layerId == null || requireLayer(item.layerId).printable !== false);
}

export const visibleItems = name => bucket(name).items.filter(layerVisible);

// Older projects lack layer membership; assign their items to the default layer.
export function normalizeLayers() {
    for (const page of bucket("pages").items) delete page.layerId;
    const fallback = defaultLayer();
    const ids = new Set(bucket(LAYERS).items.map(l => l.id));
    for (const entry of describe()) {
        const b = bucket(entry.name);
        if (!b.fields?.includes("layerId")) continue;
        for (const item of b.items) {
            if (item.layerId == null) item.layerId = fallback.id;
            else if (!ids.has(item.layerId)) throw new Error(`Unknown layer ${item.layerId} in ${b.name}`);
        }
    }
    activeLayerId();
}

export function assignLayer(items, id) {
    requireLayer(id);
    const unique = [...new Set(items)];
    if (!unique.length) throw new Error("Select board items before assigning a layer");
    checkpoint();
    for (const item of unique) item.layerId = id;
    return unique.length;
}

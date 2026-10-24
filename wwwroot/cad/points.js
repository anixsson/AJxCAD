import { bucket, defineBucket, checkpoint, newId } from "./store.js";
import { activeLayerId } from "./layers.js";
import { drawSnapIndicator } from "./snap-indicator.js";

export const POINTS = "points";
const SETTINGS = "pointSettings";
defineBucket(POINTS, { label: "Points", fields: ["id", "x", "y", "showMarker", "layerId"] });
defineBucket(SETTINGS, { label: "Point settings", fields: ["id", "scale", "visibility"], group: "project" });

export function pointSettings() {
    const saved = bucket(SETTINGS).items[0];
    return { scale: saved?.scale ?? 100, visibility: saved?.visibility ?? "local" };
}

export function setPointSettings(scale, visibility) {
    if (!Number.isInteger(scale) || scale < 25 || scale > 400 || scale % 25 !== 0)
        throw new Error("Point scale must be from 25 to 400% in steps of 25%.");
    if (!["local", "on", "off"].includes(visibility))
        throw new Error("Unknown point visibility override.");
    checkpoint();
    const items = bucket(SETTINGS).items;
    if (!items.length) items.push({ id: newId(), scale, visibility });
    else Object.assign(items[0], { scale, visibility });
}

export function markerVisible(item, settings = pointSettings()) {
    return settings.visibility === "on" || (settings.visibility === "local" && item.showMarker !== false);
}

export function addPoint(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Point coordinates must be finite.");
    const item = { id: newId(), x: x === 0 ? 0 : x, y: y === 0 ? 0 : y, showMarker: true, layerId: activeLayerId() };
    bucket(POINTS).items.push(item);
    return item;
}

export function setPointMarker(id, show) {
    const item = bucket(POINTS).items.find(p => p.id === id);
    if (!item) throw new Error(`Unknown point: ${id}`);
    if (typeof show !== "boolean") throw new Error("Point visibility must be a checkbox value.");
    checkpoint();
    item.showMarker = show;
}

// The same small vector path is drawn directly on the canvas: no per-point DOM or image allocation.
function drawMarker(g, view, item, settings) {
    if (!markerVisible(item, settings)) return;
    const p = view.toScreen(item.x, item.y);
    const unit = view.dpr * settings.scale / 100 * (view.pointPrintPx || 1);
    const x = p.x * view.dpr, y = p.y * view.dpr, r = 6 * unit, reach = 9 * unit;
    g.shadowBlur = 0;
    g.setLineDash([]);
    g.lineWidth = unit;
    g.strokeStyle = "#000";
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#e02020";
    for (const angle of [0, Math.PI]) {
        g.beginPath();
        g.moveTo(x, y);
        g.arc(x, y, r, angle, angle + Math.PI / 2);
        g.closePath();
        g.fill();
    }
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.moveTo(x - reach, y);
    g.lineTo(x + reach, y);
    g.moveTo(x, y - reach);
    g.lineTo(x, y + reach);
    g.stroke();
}

export const pointGeometry = {
    bucket: POINTS,
    points: item => [{ key: "point", x: item.x, y: item.y }],
    setPoint(item, key, x, y) {
        if (key !== "point") throw new Error(`Unknown point handle: ${key}`);
        item.x = x;
        item.y = y;
    },
    hitTest(item, sx, sy, env) {
        const p = env.toScreen(item.x, item.y);
        const distance = Math.hypot(sx - p.x, sy - p.y);
        return distance <= Math.max(10, 9 * pointSettings().scale / 100) ? distance : null;
    },
    draw(g, items, view) {
        const settings = pointSettings();
        for (const item of items) drawMarker(g, view, item, settings);
    },
    drawMovePreview(g, view, item, keys, dx, dy) {
        drawMarker(g, view, { ...item, x: item.x + dx, y: item.y + dy }, pointSettings());
    }
};

export function createPointTool(env) {
    let hover = null;
    let selectedId = null;
    const publish = () => {
        const item = bucket(POINTS).items.find(p => p.id === selectedId);
        env.pointChanged?.({ ...pointSettings(), point: item ? { ...item, showMarker: item.showMarker !== false } : null });
    };
    return {
        id: "point", hotkey: "n",
        activate: publish,
        inspect(id) { selectedId = id; publish(); },
        refresh: publish,
        deactivate() { hover = null; selectedId = null; env.pointChanged?.(null); },
        dataChanged() { selectedId = null; publish(); },
        cancel() { selectedId = null; publish(); return false; },
        pointerDown(e) {
            const p = env.snap(e.sx, e.sy);
            checkpoint();
            selectedId = addPoint(p.x, p.y).id;
            publish();
            env.log("action", "point placed");
            env.redraw();
        },
        pointerMove(e) { hover = env.snap(e.sx, e.sy); env.redraw(); },
        pointerLeave() { hover = null; env.redraw(); },
        draw(g, view) { drawSnapIndicator(g, view, hover); }
    };
}

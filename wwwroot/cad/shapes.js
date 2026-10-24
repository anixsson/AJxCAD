import { bucket, defineBucket, checkpoint, newId } from "./store.js";
import { activeLayerId } from "./layers.js";
import { drawSnapIndicator } from "./snap-indicator.js";

export const SHAPES = "shapes";
defineBucket(SHAPES, { label: "Shapes", fields: ["id", "type", "x1", "y1", "x2", "y2", "layerId"] });

export function addShape(type, a, b) {
    if (type !== "circle" && type !== "rectangle") throw new Error(`Unknown shape: ${type}`);
    const shape = {
        id: newId(), type, x1: a.x, y1: a.y, x2: b.x, y2: b.y, layerId: activeLayerId()
    };
    bucket(SHAPES).items.push(shape);
    return shape;
}

function drawShape(g, shape, view, a = { x: shape.x1, y: shape.y1 }, b = { x: shape.x2, y: shape.y2 }, preview = false) {
    const d = view.dpr;
    const p = view.toScreen(a.x, a.y), q = view.toScreen(b.x, b.y);
    g.beginPath();
    if (shape.type === "circle") {
        g.arc(p.x * d, p.y * d, Math.hypot(q.x - p.x, q.y - p.y) * d, 0, Math.PI * 2);
    } else {
        g.rect(Math.min(p.x, q.x) * d, Math.min(p.y, q.y) * d, Math.abs(q.x - p.x) * d, Math.abs(q.y - p.y) * d);
    }
    g.lineWidth = 2 * d;
    g.strokeStyle = preview ? (view.paper ? "rgba(0,0,0,0.7)" : "rgba(255,143,224,0.8)") : view.paper ? "#000" : "#8fe3ff";
    if (!preview && view.fx && !view.paper) {
        g.shadowColor = "rgba(111,208,255,0.55)";
        g.shadowBlur = 6 * d;
    }
    g.stroke();
    g.shadowBlur = 0;
}

export const shapeGeometry = {
    bucket: SHAPES,
    draw(g, items, view) {
        for (const shape of items) drawShape(g, shape, view);
    },
    selectRect(shape, rect, env) {
        if (shape.type !== "circle") return null;
        const center = env.toScreen(shape.x1, shape.y1);
        const radius = Math.hypot(env.toScreen(shape.x2, shape.y2).x - center.x, env.toScreen(shape.x2, shape.y2).y - center.y);
        return center.x - radius >= rect.left && center.x + radius <= rect.right &&
            center.y - radius >= rect.top && center.y + radius <= rect.bottom
            ? this.points(shape).map(p => p.key) : null;
    },
    points(shape) {
        if (shape.type === "circle") return [
            { key: "center", x: shape.x1, y: shape.y1 },
            { key: "radius", x: shape.x2, y: shape.y2 }
        ];
        const left = Math.min(shape.x1, shape.x2), right = Math.max(shape.x1, shape.x2);
        const bottom = Math.min(shape.y1, shape.y2), top = Math.max(shape.y1, shape.y2);
        return [
            { key: "tl", x: left, y: top }, { key: "tr", x: right, y: top },
            { key: "br", x: right, y: bottom }, { key: "bl", x: left, y: bottom }
        ];
    },
    setPoint(shape, key, x, y) {
        if (shape.type === "circle") {
            if (key === "center") { shape.x1 = x; shape.y1 = y; }
            else if (key === "radius") { shape.x2 = x; shape.y2 = y; }
            else throw new Error(`Unknown circle point: ${key}`);
            return;
        }
        const sides = { tl: ["left", "top"], tr: ["right", "top"], br: ["right", "bottom"], bl: ["left", "bottom"] }[key];
        if (!sides) throw new Error(`Unknown rectangle point: ${key}`);
        const [xSide, ySide] = sides;
        const xIsLeft = shape.x1 <= shape.x2;
        const yIsBottom = shape.y1 <= shape.y2;
        const left = Math.min(shape.x1, shape.x2), right = Math.max(shape.x1, shape.x2);
        const bottom = Math.min(shape.y1, shape.y2), top = Math.max(shape.y1, shape.y2);
        if (xSide === "left") {
            const value = Math.min(x, right - 1e-6);
            if (xIsLeft) shape.x1 = value; else shape.x2 = value;
        } else {
            const value = Math.max(x, left + 1e-6);
            if (xIsLeft) shape.x2 = value; else shape.x1 = value;
        }
        if (ySide === "bottom") {
            const value = Math.min(y, top - 1e-6);
            if (yIsBottom) shape.y1 = value; else shape.y2 = value;
        } else {
            const value = Math.max(y, bottom + 1e-6);
            if (yIsBottom) shape.y2 = value; else shape.y1 = value;
        }
    },
    moveItem(shape, dx, dy) {
        shape.x1 += dx;
        shape.x2 += dx;
        shape.y1 += dy;
        shape.y2 += dy;
    },
    drawMovePreview(g, view, shape, selectedKeys, dx, dy) {
        const moved = { ...shape };
        for (const p of this.points(shape)) {
            if (selectedKeys.has(p.key)) this.setPoint(moved, p.key, p.x + dx, p.y + dy);
        }
        g.save();
        g.setLineDash([4 * view.dpr, 4 * view.dpr]);
        drawShape(g, moved, view, undefined, undefined, true);
        g.restore();
    },
    hitTest(shape, sx, sy, env) {
        const a = env.toScreen(shape.x1, shape.y1), b = env.toScreen(shape.x2, shape.y2);
        if (shape.type === "circle") {
            const distance = Math.abs(Math.hypot(sx - a.x, sy - a.y) - Math.hypot(b.x - a.x, b.y - a.y));
            return distance <= 10 ? distance : null;
        }
        const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x);
        const top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
        const inside = sx >= left && sx <= right && sy >= top && sy <= bottom;
        if (inside) return 0;
        const dx = Math.max(left - sx, 0, sx - right), dy = Math.max(top - sy, 0, sy - bottom);
        const distance = Math.hypot(dx, dy);
        return distance <= 10 ? distance : null;
    }
};

function createShapeTool(env, type, hotkey, label) {
    let start = null;
    let hover = null;

    const resolve = e => env.gridSnap(e.sx, e.sy);

    return {
        id: type,
        hotkey,
        deactivate() {
            start = null;
            hover = null;
        },
        dataChanged() {
            this.cancel();
        },
        pointerDown(e) {
            if (e.detail >= 2) { env.setTool("cross"); return; }
            const point = resolve(e);
            if (!start) start = point;
            else if (point.x !== start.x || point.y !== start.y) {
                checkpoint();
                addShape(type, start, point);
                env.log("action", `${label} placed`);
                start = null;
            }
            hover = point;
            env.redraw();
        },
        pointerMove(e) {
            hover = resolve(e);
            env.redraw();
        },
        pointerLeave() {
            hover = null;
            env.redraw();
        },
        cancel() {
            if (!start) return false;
            start = null;
            hover = null;
            env.redraw();
            return true;
        },
        undoStep() {
            return this.cancel();
        },
        draw(g, view) {
            drawSnapIndicator(g, view, hover);
            if (!start || !hover || (start.x === hover.x && start.y === hover.y)) return;
            g.save();
            g.setLineDash([6 * view.dpr, 5 * view.dpr]);
            drawShape(g, { type }, view, start, hover);
            g.restore();
        }
    };
}

export const createCircleTool = env => createShapeTool(env, "circle", "o", "circle");
export const createRectangleTool = env => createShapeTool(env, "rectangle", "r", "rectangle");

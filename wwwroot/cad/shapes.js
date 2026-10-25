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

function drawSize(g, view, type, a, b, formatLength) {
    const d = view.dpr, p = view.toScreen(a.x, a.y), q = view.toScreen(b.x, b.y);
    const dx = b.x - a.x, dy = b.y - a.y;
    g.font = `${12 * d}px system-ui, -apple-system, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = view.paper ? "#000" : "#fff";
    g.shadowColor = view.paper ? "transparent" : "rgba(0,0,0,0.8)";
    g.shadowBlur = view.fx && !view.paper ? 4 * d : 0;
    if (type === "circle") {
        g.fillText(`Radius ${formatLength(Math.hypot(dx, dy))}`, p.x * d, p.y * d);
    } else {
        g.textBaseline = "bottom";
        g.fillText(`Width ${formatLength(Math.abs(dx))}`, (p.x + q.x) / 2 * d, (Math.min(p.y, q.y) - 8) * d);
        g.textAlign = "left";
        g.textBaseline = "middle";
        g.fillText(`Height ${formatLength(Math.abs(dy))}`, (Math.max(p.x, q.x) + 8) * d, (p.y + q.y) / 2 * d);
    }
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
    // Side handles of a rectangle: the middle of each side. Dragging one moves only that side.
    sides(shape) {
        if (shape.type !== "rectangle") return [];
        const left = Math.min(shape.x1, shape.x2), right = Math.max(shape.x1, shape.x2);
        const bottom = Math.min(shape.y1, shape.y2), top = Math.max(shape.y1, shape.y2);
        const mx = (left + right) / 2, my = (bottom + top) / 2;
        return [
            { side: "top", x: mx, y: top }, { side: "right", x: right, y: my },
            { side: "bottom", x: mx, y: bottom }, { side: "left", x: left, y: my }
        ];
    },
    setSide(shape, side, value) {
        if (shape.type !== "rectangle") throw new Error("Only rectangles have side handles.");
        if (!Number.isFinite(value)) throw new Error("A side position must be a finite number.");
        const left = Math.min(shape.x1, shape.x2), top = Math.max(shape.y1, shape.y2);
        if (side === "left") this.setPoint(shape, "tl", value, top);
        else if (side === "right") this.setPoint(shape, "tr", value, top);
        else if (side === "top") this.setPoint(shape, "tl", left, value);
        else if (side === "bottom") this.setPoint(shape, "bl", left, value);
        else throw new Error(`Unknown rectangle side: ${side}`);
    },
    moveItem(shape, dx, dy) {
        shape.x1 += dx;
        shape.x2 += dx;
        shape.y1 += dy;
        shape.y2 += dy;
    },
    drawEditFeedback(g, view, shape, formatLength) {
        g.save();
        drawSize(g, view, shape.type, { x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }, formatLength);
        g.restore();
    },
    drawMovePreview(g, view, shape, selectedKeys, dx, dy, formatLength) {
        const moved = { ...shape };
        for (const p of this.points(shape)) {
            if (selectedKeys.has(p.key)) this.setPoint(moved, p.key, p.x + dx, p.y + dy);
        }
        g.save();
        g.setLineDash([4 * view.dpr, 4 * view.dpr]);
        drawShape(g, moved, view, undefined, undefined, true);
        this.drawEditFeedback(g, view, moved, formatLength);
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
    let fixed = {};
    let previewVisible = false;
    let directionSet = false;
    let editedId = null;
    let source = null;

    const resolve = e => env.gridSnap(e.sx, e.sy);
    const endpoint = () => {
        const point = hover ?? start;
        if (!start) return null;
        let dx = point.x - start.x, dy = point.y - start.y;
        if (type === "circle" && fixed.radius !== undefined) {
            const angle = Math.atan2(dy, dx);
            dx = Math.cos(angle) * fixed.radius;
            dy = Math.sin(angle) * fixed.radius;
        } else if (type === "rectangle") {
            if (fixed.width !== undefined) dx = (dx < 0 ? -1 : 1) * fixed.width;
            if (fixed.height !== undefined) dy = (dy < 0 ? -1 : 1) * fixed.height;
        }
        return { x: start.x + dx, y: start.y + dy };
    };
    const notify = () => {
        const end = endpoint();
        env.shapeChanged?.(end ? {
            ...(editedId === null ? {} : { id: editedId }),
            type, directionSet, width: fixed.width ?? Math.abs(end.x - start.x), height: fixed.height ?? Math.abs(end.y - start.y),
            radius: fixed.radius ?? Math.hypot(end.x - start.x, end.y - start.y),
            widthFixed: fixed.width !== undefined, heightFixed: fixed.height !== undefined,
            radiusFixed: fixed.radius !== undefined
        } : null);
    };
    const clear = () => {
        start = null;
        hover = null;
        fixed = {};
        previewVisible = false;
        directionSet = false;
        editedId = null;
        source = null;
        notify();
    };

    return {
        id: type,
        hotkey,
        inspect(id) {
            const item = bucket(SHAPES).items.find(shape => shape.id === id && shape.type === type);
            if (!item) throw new Error(`Cannot inspect ${label} ${id}.`);
            const coordinates = [item.x1, item.y1, item.x2, item.y2];
            if (editedId === id && source?.every((value, index) => value === coordinates[index])) return;
            editedId = id;
            source = coordinates;
            start = { x: item.x1, y: item.y1 };
            hover = { x: item.x2, y: item.y2 };
            fixed = {};
            directionSet = true;
            previewVisible = true;
            notify();
            env.redraw();
        },
        deactivate() {
            clear();
        },
        dataChanged() {
            this.cancel();
        },
        pointerDown(e) {
            if (directionSet) return;
            const point = resolve(e);
            hover = point;
            previewVisible = true;
            if (!start) {
                start = point;
                notify();
            } else {
                directionSet = point.x !== start.x || point.y !== start.y;
                notify();
            }
            env.redraw();
        },
        pointerMove(e) {
            if (directionSet) return;
            hover = resolve(e);
            previewVisible = true;
            if (start) notify();
            env.redraw();
        },
        pointerLeave() {
            if (!start) hover = null;
            if (!directionSet) previewVisible = false;
            env.redraw();
        },
        setDimension(field, value) {
            if (!start) throw new Error("Pick the first shape point before setting dimensions.");
            if (!(type === "circle" ? field === "radius" : field === "width" || field === "height"))
                throw new Error(`Unknown ${type} dimension: ${field}`);
            if (!Number.isFinite(value) || value <= 0)
                throw new Error("Shape dimensions must be positive, finite numbers.");
            fixed[field] = value;
            previewVisible = true;
            notify();
            env.redraw();
        },
        useCursor() {
            if (editedId !== null) throw new Error("A saved shape's direction is set by its selected handles.");
            fixed = {};
            directionSet = false;
            previewVisible = !!start;
            notify();
            env.redraw();
        },
        save() {
            if (!directionSet) {
                env.log("error", "Click the board a second time to set the direction before placing.");
                return false;
            }
            const end = endpoint();
            if (!end || (type === "circle"
                ? Math.hypot(end.x - start.x, end.y - start.y) <= 0
                : end.x === start.x || end.y === start.y)) {
                env.log("error", type === "circle" ? "Set a positive radius." : "Set a positive width and height.");
                return false;
            }
            const item = editedId === null ? null : bucket(SHAPES).items.find(shape => shape.id === editedId);
            if (editedId !== null && !item) throw new Error(`The selected ${label} no longer exists.`);
            checkpoint();
            if (item) Object.assign(item, { x2: end.x, y2: end.y });
            else addShape(type, start, end);
            env.log("action", `${label} ${item ? "updated" : "placed"}`);
            clear();
            env.redraw();
            return true;
        },
        cancel() {
            if (!start) return false;
            clear();
            env.redraw();
            return true;
        },
        undoStep() {
            return this.cancel();
        },
        draw(g, view) {
            if (previewVisible && editedId === null) drawSnapIndicator(g, view, hover);
            if (!start || !previewVisible) return;
            const end = endpoint();
            if (end.x === start.x && end.y === start.y) return;
            g.save();
            g.setLineDash([6 * view.dpr, 5 * view.dpr]);
            drawShape(g, { type }, view, start, end);
            drawSize(g, view, type, start, end, env.formatLength);
            g.restore();
        }
    };
}

export const createCircleTool = env => createShapeTool(env, "circle", "o", "circle");
export const createRectangleTool = env => createShapeTool(env, "rectangle", "r", "rectangle");

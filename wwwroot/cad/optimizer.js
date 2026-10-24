import { dimensionOf } from "./tools/measurement.js";

export const MIN_DETAIL_PX = 3;

export function detailSize(name, item) {
    if (name === "texts") return item.fontSize ?? 4.5;
    if (name === "lines" || name === "shapes") {
        const length = Math.hypot(item.x2 - item.x1, item.y2 - item.y1);
        return name === "shapes" && item.type === "circle" ? length * 2 : length;
    }
    if (name === "measures") {
        const points = item.points.filter(p => p.enabled !== false);
        const dim = dimensionOf(points, item.dimension);
        const extent = dim ? [...points, dim.a2, dim.b2] : points;
        if (!extent.length) return 0;
        let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
        for (const p of extent) {
            left = Math.min(left, p.x);
            right = Math.max(right, p.x);
            bottom = Math.min(bottom, p.y);
            top = Math.max(top, p.y);
        }
        return Math.hypot(right - left, top - bottom);
    }
    // Point markers and page frames remain visible at every zoom.
    return Infinity;
}

export function belowDetailThreshold(name, item, scale) {
    return detailSize(name, item) * scale < MIN_DETAIL_PX;
}

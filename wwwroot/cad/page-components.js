// Page-local positions and sizes are in paper mm, independent of drawing zoom.
import { isVisible, pageRect, scaleLabel } from "./pages.js";

export const COMPONENTS = ["compass", "ruler"];
export const validComponent = c => c === null || (typeof c === "object" &&
    Number.isFinite(c.x) && Number.isFinite(c.y) &&
    Number.isFinite(c.size) && c.size >= 25 && c.size <= 400 &&
    Number.isFinite(c.angle));

export function componentAt(page, point, size = 100, angle = 0) {
    return { x: (point.x - page.x) / page.scale, y: (point.y - page.y) / page.scale, size, angle };
}

// Shared vector geometry keeps canvas preview and PDF output identical.
export function pageComponentGeometry(page, formatLength) {
    if (!isVisible(page)) return [];
    const result = [];
    for (const kind of COMPONENTS) {
        const c = page[kind];
        if (!c) continue;
        const s = c.size / 100;
        const at = (x, y) => ({
            x: page.x + (c.x + x) * page.scale,
            y: page.y + (c.y + y) * page.scale
        });
        const path = (points, fill = false) => result.push({ points: points.map(([x, y]) => at(x, y)), fill, width: 0.3 * s });
        const label = (value, x, y, size) => result.push({ text: value, at: at(x, y), size: size * s });
        if (kind === "compass") {
            const rotate = (x, y) => [
                (x * Math.cos(c.angle) - y * Math.sin(c.angle)) * s,
                (x * Math.sin(c.angle) + y * Math.cos(c.angle)) * s
            ];
            path([[0, 9], [-3, -6], [0, -3], [0, 9]].map(([x, y]) => rotate(x, y)), true);
            path([[0, 9], [3, -6], [0, -3], [0, 9]].map(([x, y]) => rotate(x, y)));
            const [nx, ny] = rotate(0, 12);
            label("N", nx, ny, 3.5);
        } else {
            const target = 40 * page.scale;
            const power = 10 ** Math.floor(Math.log10(target));
            const length = ([5, 2, 1].map(m => m * power).find(v => v <= target) ?? power) * s;
            const w = length / page.scale, left = -w / 2;
            for (let i = 0; i < 4; i++) {
                const x = left + w * i / 4;
                path([[x, 0], [x + w / 4, 0], [x + w / 4, 2 * s], [x, 2 * s], [x, 0]], i % 2 === 0);
            }
            label("0", left, 5 * s, 2.8);
            label(formatLength(length), w / 2, 5 * s, 2.8);
            label(`Scale ${scaleLabel(page.scale)}`, 0, -4 * s, 3);
        }
    }
    return result;
}

export function drawPageComponents(g, page, view, formatLength) {
    const geometry = pageComponentGeometry(page, formatLength);
    if (!geometry.length) return;
    const d = view.dpr, r = pageRect(page);
    const a = view.toScreen(r.left, r.top), b = view.toScreen(r.right, r.bottom);
    const origin = view.toScreen(page.x, page.y), unit = view.toScreen(page.x + page.scale, page.y);
    const paperPx = Math.abs(unit.x - origin.x) * d;
    g.save();
    g.beginPath();
    g.rect(a.x * d, a.y * d, (b.x - a.x) * d, (b.y - a.y) * d);
    g.clip();
    g.strokeStyle = g.fillStyle = view.paper ? "#000" : "#96ffbe";
    g.setLineDash([]);
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const mark of geometry) {
        if (mark.text !== undefined) {
            const p = view.toScreen(mark.at.x, mark.at.y);
            g.font = `${mark.size * paperPx}px Helvetica, Arial, sans-serif`;
            g.fillText(mark.text, p.x * d, p.y * d);
        } else {
            g.lineWidth = mark.width * paperPx;
            g.beginPath();
            mark.points.forEach((point, i) => {
                const p = view.toScreen(point.x, point.y);
                if (i === 0) g.moveTo(p.x * d, p.y * d);
                else g.lineTo(p.x * d, p.y * d);
            });
            if (mark.fill) g.fill();
            else g.stroke();
        }
    }
    g.restore();
}

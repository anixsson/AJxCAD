// Minimal single-page vector PDF of a page frame: drawing, saved measurements and page components inside the frame,
// at the page's scale. Written by hand (PDF 1.4, ASCII only) so no library is needed.
// Two-point measurements with a dimension print as a CAD dimension (extension lines, arrows, rotated length).
// Measurements follow their own Lengths / Angles / Area settings and use the Paper look; their text and label
// boxes use PRINT_SIZES (points) times the page's text size.

import { pageRect, paperSize, textSizeOf } from "./pages.js";
import { pageComponentGeometry } from "./page-components.js";
import { layerPrintable } from "./layers.js";
import { pointSettings, markerVisible } from "./points.js";
import { symbolSourceState, symbolBounds, symbolFormat, symbolItems } from "./symbols.js";
import { displayOf, polygonArea, polygonCentroid, corners, formatAngle, dimensionOf, readableAngle, PRINT_SIZES, scaleSizes } from "./tools/measurement.js";

const PT_PER_MM = 72 / 25.4;
const n = v => `${+v.toFixed(3)}`;

// Cohen–Sutherland style trivial reject: skip lines entirely on one side of the frame.
const outside = (l, r) =>
    (l.x1 < r.left && l.x2 < r.left) || (l.x1 > r.right && l.x2 > r.right) ||
    (l.y1 < r.bottom && l.y2 < r.bottom) || (l.y1 > r.top && l.y2 > r.top);

// Helvetica widths (per 1000 units) for the characters labels use; others count as a digit.
const WIDTHS = { " ": 278, ".": 278, ",": 278, "-": 333, "−": 584, "m": 833, "c": 500, "i": 222, "n": 556, "f": 278, "t": 278, "°": 400, "²": 333 };
const textWidth = (text, size) => [...text].reduce((w, ch) => w + (WIDTHS[ch] ?? 556), 0) * size / 1000;

// PDF string in WinAnsi encoding, kept ASCII with octal escapes.
const ESCAPES = { "\\": "\\\\", "(": "\\(", ")": "\\)", "°": "\\260", "²": "\\262", "−": "-" };
const pdfString = text => `(${[...text].map(ch => ESCAPES[ch] ?? (ch < "\x7f" ? ch : "?")).join("")})`;

// Text at (x, y); `center` centres it on that point horizontally and vertically.
function text(out, str, x, y, size, center = false, font = "F1") {
    const tx = center ? x - textWidth(str, size) / 2 : x;
    const ty = center ? y - size * 0.35 : y;
    out.push(`BT /${font} ${n(size)} Tf ${n(tx)} ${n(ty)} Td ${pdfString(str)} Tj ET`);
}

// Circle path from four Bézier curves.
function circle(out, x, y, r) {
    const k = r * 0.5523;
    out.push(`${n(x + r)} ${n(y)} m`,
        `${n(x + r)} ${n(y + k)} ${n(x + k)} ${n(y + r)} ${n(x)} ${n(y + r)} c`,
        `${n(x - k)} ${n(y + r)} ${n(x - r)} ${n(y + k)} ${n(x - r)} ${n(y)} c`,
        `${n(x - r)} ${n(y - k)} ${n(x - k)} ${n(y - r)} ${n(x)} ${n(y - r)} c`,
        `${n(x + k)} ${n(y - r)} ${n(x + r)} ${n(y - k)} ${n(x + r)} ${n(y)} c h`);
}

// Rounded "pill" box centred on (x, y).
function pill(out, x, y, w, h) {
    const r = h / 2, k = r * 0.5523, l = x - w / 2 + r, rt = x + w / 2 - r, b = y - r, t = y + r;
    out.push(`${n(l)} ${n(b)} m ${n(rt)} ${n(b)} l`,
        `${n(rt + k)} ${n(b)} ${n(rt + r)} ${n(y - k)} ${n(rt + r)} ${n(y)} c`,
        `${n(rt + r)} ${n(y + k)} ${n(rt + k)} ${n(t)} ${n(rt)} ${n(t)} c`,
        `${n(l)} ${n(t)} l`,
        `${n(l - k)} ${n(t)} ${n(l - r)} ${n(y + k)} ${n(l - r)} ${n(y)} c`,
        `${n(l - r)} ${n(y - k)} ${n(l - k)} ${n(b)} ${n(l)} ${n(b)} c h`);
}

const polyline = pts => pts.map((p, i) => `${n(p.x)} ${n(p.y)} ${i ? "l" : "m"}`).join(" ");

// CAD dimension in points: extension lines, the dimension line with filled arrows, and the length above it.
function dimension(dim, label, sz, marks) {
    const { a, b, a2, b2 } = dim;
    marks.push("0 G 0 g 0.5 w");
    const ex = a2.x - a.x, ey = a2.y - a.y, el = Math.hypot(ex, ey);
    if (el > sz.extGap) {
        const ux = ex / el, uy = ey / el;
        for (const [p, q] of [[a, a2], [b, b2]]) {
            marks.push(polyline([{ x: p.x + ux * sz.extGap, y: p.y + uy * sz.extGap }, { x: q.x + ux * sz.extOver, y: q.y + uy * sz.extOver }]), "S");
        }
    }
    marks.push(polyline([a2, b2]), "S");
    const vx = b2.x - a2.x, vy = b2.y - a2.y, vl = Math.hypot(vx, vy);
    if (vl < 1e-6) return;
    const ux = vx / vl, uy = vy / vl;
    for (const [tip, dx, dy] of [[a2, -ux, -uy], [b2, ux, uy]]) {
        const bx = tip.x - dx * sz.arrow, by = tip.y - dy * sz.arrow;
        marks.push(polyline([tip, { x: bx - dy * sz.arrowHalf, y: by + dx * sz.arrowHalf }, { x: bx + dy * sz.arrowHalf, y: by - dx * sz.arrowHalf }]), "h f");
    }
    if (!label) return;
    const angle = readableAngle(vx, vy), c = Math.cos(angle), s = Math.sin(angle);
    const w = textWidth(label, sz.length);
    // Baseline start: the middle of the line, lifted by the gap and moved back half the text width.
    const x = (a2.x + b2.x) / 2 - s * sz.dimGap - c * w / 2, y = (a2.y + b2.y) / 2 + c * sz.dimGap - s * w / 2;
    marks.push(`BT /F1 ${n(sz.length)} Tf ${n(c)} ${n(s)} ${n(-s)} ${n(c)} ${n(x)} ${n(y)} Tm ${pdfString(label)} Tj ET`);
}

// One saved measurement, already in points. `fills` is drawn under the drawing lines, `marks` on top.
function measurement(world, pts, options, format, sz, fills, marks, dim = null) {
    if (dim) {
        dimension(dim, options.showLengths ? format.length(dim.length) : null, sz, marks);
        for (const p of pts) circle(marks, p.x, p.y, sz.dot);
        marks.push("f");
        return;
    }
    const closed = pts.length >= 3;
    if (closed && options.showArea) fills.push(`${polyline(pts)} h f`);

    if (closed) {
        // Dashed closing line from the last point back to the first, as on the board.
        marks.push("0.55 G 0.5 w [2 3] 0 d", polyline([pts.at(-1), pts[0]]), "S");
    }
    marks.push("0 G 0.9 w [4 3] 0 d", polyline(pts), "S [] 0 d");

    marks.push("0 g");
    if (options.showLengths) {
        for (let i = 1; i < pts.length; i++) {
            const len = Math.hypot(world[i].x - world[i - 1].x, world[i].y - world[i - 1].y);
            if (len > 0) text(marks, format.length(len), (pts[i - 1].x + pts[i].x) / 2 + sz.lengthOffset, (pts[i - 1].y + pts[i].y) / 2 + sz.lengthOffset, sz.length);
        }
    }

    if (closed && options.showAngles) {
        for (const c of corners(pts)) {
            const la = Math.hypot(c.a.x - c.v.x, c.a.y - c.v.y), lb = Math.hypot(c.b.x - c.v.x, c.b.y - c.v.y);
            const r = Math.min(sz.arcRadius, la / 2, lb / 2);
            if (r < sz.arcMin) continue;
            const a1 = Math.atan2(c.a.y - c.v.y, c.a.x - c.v.x);
            let delta = Math.atan2(c.b.y - c.v.y, c.b.x - c.v.x) - a1;
            while (delta > Math.PI) delta -= 2 * Math.PI;
            while (delta <= -Math.PI) delta += 2 * Math.PI;
            const arc = Array.from({ length: 17 }, (_, i) => {
                const t = a1 + delta * i / 16;
                return { x: c.v.x + Math.cos(t) * r, y: c.v.y + Math.sin(t) * r };
            });
            marks.push("0 G 0.75 w", polyline(arc), "S");
            const mid = a1 + delta / 2;
            text(marks, formatAngle(c.deg), c.v.x + Math.cos(mid) * (r + sz.angleGap), c.v.y + Math.sin(mid) * (r + sz.angleGap), sz.angle, true);
        }
    }

    if (closed && options.showArea) {
        const area = polygonArea(world);
        if (area > 0) {
            const label = format.area(area), at = polygonCentroid(pts), size = sz.area;
            const w = textWidth(label, size) + sz.pillPad, h = sz.pillHeight;
            marks.push("1 g 0.3 G 0.5 w");
            pill(marks, at.x, at.y, w, h);
            marks.push("B 0 g");
            text(marks, label, at.x, at.y, size, true);
        }
    }

    for (const p of pts) circle(marks, p.x, p.y, sz.dot);
    marks.push("f");
}

// `measures` are the saved measurement items; `format` gives { length(mm), area(mm²) } in the project units.
export function pagePdf(page, lines, measures = [], format = { length: mm => `${+mm.toFixed(1)} mm`, area: mm2 => `${+mm2.toFixed(1)} mm²` }, shapes = [], texts = [], points = [], symbols = [], options = {}) {
    const printable = options.printable ?? layerPrintable;
    const paper = paperSize(page);
    const w = paper.w * PT_PER_MM, h = paper.h * PT_PER_MM;
    const r = pageRect(page);
    const k = PT_PER_MM / page.scale; // world mm -> points
    const px = x => n((x - r.left) * k), py = y => n((y - r.bottom) * k);
    const toPaper = p => ({ x: (p.x - r.left) * k, y: (p.y - r.bottom) * k });

    const path = [];
    for (const l of lines) {
        if (!printable(l)) continue;
        if (outside(l, r)) continue;
        path.push(`${px(l.x1)} ${py(l.y1)} m ${px(l.x2)} ${py(l.y2)} l`);
    }
    for (const shape of shapes) {
        if (!printable(shape)) continue;
        if (shape.type === "circle") {
            const radius = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1);
            circle(path, (shape.x1 - r.left) * k, (shape.y1 - r.bottom) * k, radius * k);
        } else if (shape.type === "rectangle") {
            const left = (Math.min(shape.x1, shape.x2) - r.left) * k;
            const bottom = (Math.min(shape.y1, shape.y2) - r.bottom) * k;
            const width = Math.abs(shape.x2 - shape.x1) * k, height = Math.abs(shape.y2 - shape.y1) * k;
            path.push(`${n(left)} ${n(bottom)} ${n(width)} ${n(height)} re`);
        } else {
            throw new Error(`Unknown shape type: ${shape.type}`);
        }
    }

    const fills = [], marks = [], measurementMarks = [];
    const sz = scaleSizes(PRINT_SIZES, textSizeOf(page) / 100 * (options.annotationScale ?? 1));
    for (const item of measures) {
        if (!printable(item)) continue;
        const world = item.points.filter(p => p.enabled !== false);
        if (world.length < 2) continue;
        const dim = dimensionOf(world, item.dimension);
        const reach = dim ? [...world, dim.a2, dim.b2] : world;
        const xs = reach.map(p => p.x), ys = reach.map(p => p.y);
        if (Math.max(...xs) < r.left || Math.min(...xs) > r.right || Math.max(...ys) < r.bottom || Math.min(...ys) > r.top) continue;
        const paperDim = dim && { length: dim.length, a: toPaper(dim.a), b: toPaper(dim.b), a2: toPaper(dim.a2), b2: toPaper(dim.b2) };
        measurement(world, world.map(toPaper), displayOf(item), format, sz, fills, measurementMarks, paperDim);
    }
    for (const item of texts) {
        if (!printable(item)) continue;
        const size = (item.fontSize ?? 4.5) * k;
        const family = item.fontFamily ?? "sans-serif";
        const font = family === "serif"
            ? item.bold ? (item.italic ? "F8" : "F6") : (item.italic ? "F7" : "F5")
            : family === "monospace"
                ? item.bold ? (item.italic ? "F12" : "F10") : (item.italic ? "F11" : "F9")
                : item.bold ? (item.italic ? "F4" : "F2") : (item.italic ? "F3" : "F1");
        const x = (item.x - r.left) * k, y = (item.y - r.bottom) * k;
        text(marks, item.text, x, y, size, false, font);
        if (item.underline) marks.push(`${n(x)} ${n(y - size * 0.15)} m ${n(x + textWidth(item.text, size))} ${n(y - size * 0.15)} l S`);
    }

    const settings = options.pointSettings ?? pointSettings();
    for (const item of points) {
        if (!printable(item) || !markerVisible(item, settings)) continue;
        const p = toPaper(item), unit = 0.75 * settings.scale / 100 * (options.annotationScale ?? 1), radius = 6 * unit, reach = 9 * unit;
        if (p.x + reach < 0 || p.x - reach > w || p.y + reach < 0 || p.y - reach > h) continue;
        marks.push(`q 0 G 1 g ${n(unit)} w [] 0 d`);
        circle(marks, p.x, p.y, radius);
        marks.push("f", "0.878 0.125 0.125 rg");
        const c = radius * 0.5523;
        for (const sign of [1, -1]) {
            const dx = radius * sign, dy = -radius * sign;
            marks.push(`${n(p.x)} ${n(p.y)} m ${n(p.x + dx)} ${n(p.y)} l`,
                `${n(p.x + dx)} ${n(p.y - c * sign)} ${n(p.x + c * sign)} ${n(p.y + dy)} ${n(p.x)} ${n(p.y + dy)} c h f`);
        }
        circle(marks, p.x, p.y, radius);
        marks.push(`${n(p.x - reach)} ${n(p.y)} m ${n(p.x + reach)} ${n(p.y)} l`,
            `${n(p.x)} ${n(p.y - reach)} m ${n(p.x)} ${n(p.y + reach)} l S Q`);
    }

    for (const item of symbols) {
        if (!printable(item)) continue;
        const bounds = symbolBounds(item);
        const x = (bounds.left - r.left) * k, y = (bounds.bottom - r.bottom) * k;
        const width = (bounds.right - bounds.left) * k, height = (bounds.top - bounds.bottom) * k;
        if (x + width < 0 || x > w || y + height < 0 || y > h) continue;
        const state = symbolSourceState(item), ancestry = options.ancestry ?? new Set();
        if (!state.source || ancestry.has(item.source)) {
            marks.push(`q 0 G 0.6 w ${n(x)} ${n(y)} ${n(width)} ${n(height)} re S`,
                `${n(x)} ${n(y)} m ${n(x + width)} ${n(y + height)} l`,
                `${n(x)} ${n(y + height)} m ${n(x + width)} ${n(y)} l S 0 g`);
            text(marks, "Missing symbol import", x + width / 2, y + height / 2, 9, true);
            marks.push("Q");
            continue;
        }
        const source = state.source, items = symbolItems(item, source);
        const sourcePage = { ...page, x: (page.x - item.x) / item.scale, y: (page.y - item.y) / item.scale,
            scale: page.scale / item.scale, compass: null, ruler: null };
        marks.push(pagePdf(sourcePage, items("lines"), items("measures"), symbolFormat(source.project),
            items("shapes"), items("texts"), items("points"), items("symbols"), {
                contentOnly: true, printable: () => true, pointSettings: source.settings,
                annotationScale: (options.annotationScale ?? 1) * item.scale,
                ancestry: new Set(ancestry).add(item.source)
            }));
    }

    marks.push(...measurementMarks);
    for (const mark of pageComponentGeometry(page, format.length)) {
        if (mark.text !== undefined) {
            const p = toPaper(mark.at);
            marks.push("0 g");
            text(marks, mark.text, p.x, p.y, mark.size * PT_PER_MM, true);
        } else {
            marks.push(`0 G 0 g ${n(mark.width * PT_PER_MM)} w [] 0 d`,
                polyline(mark.points.map(toPaper)), mark.fill ? "h f" : "S");
        }
    }

    // Clip to the paper; area shading goes under the lines (light grey), lines are stroked once in black,
    // and the measurement lines and labels go on top.
    const content = [
        `q 0 0 ${n(w)} ${n(h)} re W n`,
        ...(fills.length ? ["0.94 g", ...fills] : []),
        "0.6 w 1 J 1 j 0 G 0 g", ...path, path.length ? "S" : "",
        ...marks,
        "Q"
    ].join("\n");
    if (options.contentOnly) return content;

    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(w)} ${n(h)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique /Encoding /WinAnsiEncoding >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic /Encoding /WinAnsiEncoding >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Times-BoldItalic /Encoding /WinAnsiEncoding >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Oblique /Encoding /WinAnsiEncoding >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-BoldOblique /Encoding /WinAnsiEncoding >>"
    ];
    objects[2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(w)} ${n(h)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R /F4 8 0 R /F5 9 0 R /F6 10 0 R /F7 11 0 R /F8 12 0 R /F9 13 0 R /F10 14 0 R /F11 15 0 R /F12 16 0 R >> >> >>`;
    let out = "%PDF-1.4\n";
    const offsets = [];
    objects.forEach((body, i) => {
        offsets.push(out.length);
        out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    out += offsets.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return out;
}

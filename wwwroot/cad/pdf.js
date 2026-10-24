// Minimal single-page vector PDF of a page frame: drawing lines and saved measurements inside the frame,
// at the page's scale. Written by hand (PDF 1.4, ASCII only) so no library is needed.
// Measurements follow their own Lengths / Angles / Area settings and use the Paper look.

import { pageRect, paperSize } from "./pages.js";
import { displayOf, polygonArea, polygonCentroid, corners, formatAngle } from "./tools/ruler.js";

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
function text(out, str, x, y, size, center = false) {
    const tx = center ? x - textWidth(str, size) / 2 : x;
    const ty = center ? y - size * 0.35 : y;
    out.push(`BT /F1 ${n(size)} Tf ${n(tx)} ${n(ty)} Td ${pdfString(str)} Tj ET`);
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

// One saved measurement, already in points. `fills` is drawn under the drawing lines, `marks` on top.
function measurement(world, pts, options, format, fills, marks) {
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
            if (len > 0) text(marks, format.length(len), (pts[i - 1].x + pts[i].x) / 2 + 4, (pts[i - 1].y + pts[i].y) / 2 + 4, 7);
        }
    }

    if (closed && options.showAngles) {
        for (const c of corners(pts)) {
            const la = Math.hypot(c.a.x - c.v.x, c.a.y - c.v.y), lb = Math.hypot(c.b.x - c.v.x, c.b.y - c.v.y);
            const r = Math.min(9, la / 2, lb / 2);
            if (r < 2) continue;
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
            text(marks, formatAngle(c.deg), c.v.x + Math.cos(mid) * (r + 7), c.v.y + Math.sin(mid) * (r + 7), 6.5, true);
        }
    }

    if (closed && options.showArea) {
        const area = polygonArea(world);
        if (area > 0) {
            const label = format.area(area), at = polygonCentroid(pts), size = 8;
            const w = textWidth(label, size) + 7, h = 11;
            marks.push("1 g 0.3 G 0.5 w");
            pill(marks, at.x, at.y, w, h);
            marks.push("B 0 g");
            text(marks, label, at.x, at.y, size, true);
        }
    }

    for (const p of pts) circle(marks, p.x, p.y, 1.5);
    marks.push("f");
}

// `measures` are the saved measurement items; `format` gives { length(mm), area(mm²) } in the project units.
export function pagePdf(page, lines, measures = [], format = { length: mm => `${+mm.toFixed(1)} mm`, area: mm2 => `${+mm2.toFixed(1)} mm²` }) {
    const paper = paperSize(page);
    const w = paper.w * PT_PER_MM, h = paper.h * PT_PER_MM;
    const r = pageRect(page);
    const k = PT_PER_MM / page.scale; // world mm -> points
    const px = x => n((x - r.left) * k), py = y => n((y - r.bottom) * k);
    const toPaper = p => ({ x: (p.x - r.left) * k, y: (p.y - r.bottom) * k });

    const path = [];
    for (const l of lines) {
        if (outside(l, r)) continue;
        path.push(`${px(l.x1)} ${py(l.y1)} m ${px(l.x2)} ${py(l.y2)} l`);
    }

    const fills = [], marks = [];
    for (const item of measures) {
        const world = item.points.filter(p => p.enabled !== false);
        if (world.length < 2) continue;
        const xs = world.map(p => p.x), ys = world.map(p => p.y);
        if (Math.max(...xs) < r.left || Math.min(...xs) > r.right || Math.max(...ys) < r.bottom || Math.min(...ys) > r.top) continue;
        measurement(world, world.map(toPaper), displayOf(item), format, fills, marks);
    }

    // Clip to the paper; area shading goes under the lines (light grey), lines are stroked once in black,
    // and the measurement lines and labels go on top.
    const content = [
        `q 0 0 ${n(w)} ${n(h)} re W n`,
        ...(fills.length ? ["0.94 g", ...fills] : []),
        "0.6 w 1 J 1 j 0 G", ...path, path.length ? "S" : "",
        ...marks,
        "Q"
    ].join("\n");

    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(w)} ${n(h)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    ];
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

// Minimal single-page vector PDF of a page frame: drawing lines inside the frame, at the page's scale.
// Written by hand (PDF 1.4, ASCII only) so no library is needed.

import { pageRect, paperSize } from "./pages.js";

const PT_PER_MM = 72 / 25.4;
const n = v => `${+v.toFixed(3)}`;

// Cohen–Sutherland style trivial reject: skip lines entirely on one side of the frame.
const outside = (l, r) =>
    (l.x1 < r.left && l.x2 < r.left) || (l.x1 > r.right && l.x2 > r.right) ||
    (l.y1 < r.bottom && l.y2 < r.bottom) || (l.y1 > r.top && l.y2 > r.top);

export function pagePdf(page, lines) {
    const paper = paperSize(page);
    const w = paper.w * PT_PER_MM, h = paper.h * PT_PER_MM;
    const r = pageRect(page);
    const k = PT_PER_MM / page.scale; // world mm -> points
    const px = x => n((x - r.left) * k), py = y => n((y - r.bottom) * k);

    const path = [];
    for (const l of lines) {
        if (outside(l, r)) continue;
        path.push(`${px(l.x1)} ${py(l.y1)} m ${px(l.x2)} ${py(l.y2)} l`);
    }
    // Clip to the paper, then stroke every line once in black.
    const content = [`q 0 0 ${n(w)} ${n(h)} re W n`, "0.6 w 1 J 1 j 0 G", ...path, path.length ? "S" : "", "Q"].join("\n");

    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(w)} ${n(h)}] /Contents 4 0 R /Resources << >> >>`,
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
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

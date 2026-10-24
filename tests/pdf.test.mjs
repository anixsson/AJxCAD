import test from "node:test";
import assert from "node:assert/strict";
import { pagePdf } from "../wwwroot/cad/pdf.js";

const page = { paper: "A4", landscape: 0, scale: 10, x: 0, y: 0 }; // frame 2100 × 2970 mm around the origin

test("the PDF is one A4 page with a valid cross-reference table", () => {
    const pdf = pagePdf(page, []);
    assert.ok(pdf.startsWith("%PDF-1.4\n"));
    assert.ok(pdf.endsWith("%%EOF\n"));
    assert.match(pdf, /\/MediaBox \[0 0 595\.276 841\.89\]/);
    assert.ok(/^[\x00-\x7f]*$/.test(pdf), "ASCII only, so string length equals byte length");

    const startxref = Number(pdf.match(/startxref\n(\d+)/)[1]);
    assert.ok(pdf.slice(startxref).startsWith("xref\n0 6\n"));
    const offsets = [...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
    assert.equal(offsets.length, 5);
    offsets.forEach((o, i) => assert.ok(pdf.slice(o).startsWith(`${i + 1} 0 obj\n`), `object ${i + 1} offset`));

    const length = Number(pdf.match(/\/Length (\d+)/)[1]);
    const stream = pdf.slice(pdf.indexOf("stream\n") + 7, pdf.indexOf("\nendstream"));
    assert.equal(stream.length, length);
});

test("lines are placed at the page scale and lines outside the frame are left out", () => {
    const pdf = pagePdf(page, [
        { x1: -1050, y1: -1485, x2: 0, y2: 0 },   // frame corner to centre
        { x1: 5000, y1: 0, x2: 6000, y2: 10 },     // entirely to the right
        { x1: -2000, y1: 0, x2: 2000, y2: 0 }      // crosses the frame: kept, clipped by the PDF
    ]);
    const k = 72 / 25.4 / 10;
    const c = v => `${+v.toFixed(3)}`;
    assert.ok(pdf.includes(`0 0 m ${c(1050 * k)} ${c(1485 * k)} l`));
    assert.ok(pdf.includes(`${c(-950 * k)} ${c(1485 * k)} m ${c(3050 * k)} ${c(1485 * k)} l`));
    assert.equal(pdf.match(/ m /g).length, 2);
    assert.ok(pdf.includes("q 0 0 595.276 841.89 re W n"), "clipped to the paper");
});

test("landscape swaps the paper size", () => {
    assert.match(pagePdf({ ...page, landscape: 1 }, []), /\/MediaBox \[0 0 841\.89 595\.276\]/);
});

const square = (extra = {}) => ({
    id: 1,
    points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }],
    ...extra
});
const format = { length: mm => `${mm / 10} cm`, area: mm2 => `${mm2 / 100} cm²` };
const stream = pdf => pdf.slice(pdf.indexOf("stream\n") + 7, pdf.indexOf("\nendstream"));

test("saved measurements print with their lengths, angles and area", () => {
    const pdf = pagePdf(page, [], [square()], format);
    const body = stream(pdf);
    assert.equal((body.match(/\(100 cm\) Tj/g) ?? []).length, 3, "a length label per measured line");
    assert.equal((body.match(/\(90\\260\) Tj/g) ?? []).length, 4, "an angle at every corner, with a degree sign");
    assert.ok(body.includes("(10000 cm\\262) Tj"), "area label with a superscript two");
    assert.ok(body.includes("0.94 g"), "the area is shaded");
    assert.ok(pdf.includes("/BaseFont /Helvetica"));
    assert.ok(/^[\x00-\x7f]*$/.test(pdf), "still ASCII only");
});

test("each measurement's display settings decide what is printed", () => {
    const body = stream(pagePdf(page, [], [square({ showLengths: false, showAngles: false, showArea: false })], format));
    assert.ok(!body.includes("Tj"), "no labels");
    assert.ok(!body.includes("0.94 g"), "no shading");
    assert.ok(body.includes("[4 3] 0 d"), "the measured lines are still drawn");

    const lengthsOnly = stream(pagePdf(page, [], [square({ showAngles: false, showArea: false })], format));
    assert.equal((lengthsOnly.match(/Tj/g) ?? []).length, 3);
});

test("measurements outside the frame and unchecked points are left out", () => {
    const far = { id: 2, points: [{ x: 9000, y: 9000 }, { x: 9500, y: 9000 }] };
    assert.ok(!stream(pagePdf(page, [], [far], format)).includes("[4 3] 0 d"));

    const partly = square();
    partly.points[3].enabled = false; // only three corners: a triangle
    const body = stream(pagePdf(page, [], [partly], format));
    assert.ok(body.includes("(5000 cm\\262) Tj"), "area of the remaining triangle");
});

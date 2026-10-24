import test from "node:test";
import assert from "node:assert/strict";
import { bucket, serialize, deserialize, undo } from "../wwwroot/cad/store.js";
import { createRulerTool, MEASURES } from "../wwwroot/cad/tools/ruler.js";

const lines = bucket("lines");

function setup(items) {
    lines.items = items.map((line, id) => ({ id: id + 1, ...line }));
    bucket(MEASURES).items = [];
    const measures = [];
    const tool = createRulerTool({
        geometries: [{
            bucket: "lines",
            points: line => [
                { key: "a", x: line.x1, y: line.y1 },
                { key: "b", x: line.x2, y: line.y2 }
            ]
        }],
        toScreen: (x, y) => ({ x, y }),
        // Grid of 10, with line ends winning within 5 px (like the engine's snap).
        snap(sx, sy) {
            for (const l of lines.items) {
                for (const [x, y] of [[l.x1, l.y1], [l.x2, l.y2]]) {
                    if (Math.hypot(x - sx, y - sy) <= 5) return { x, y, kind: "end" };
                }
            }
            return { x: Math.round(sx / 10) * 10, y: Math.round(sy / 10) * 10, kind: "grid" };
        },
        formatLength: mm => `${+mm.toFixed(3)} mm`,
        formatArea: mm2 => `${+mm2.toFixed(3)} mm²`,
        measureChanged: info => measures.push(info),
        redraw() {},
        log() {}
    });
    return { tool, measures };
}

const click = (tool, sx, sy) => tool.pointerDown({ sx, sy });
const total = info => ({ mode: info.mode, length: info.length, area: info.area, points: info.points });

test("two clicks measure length, deltas and both points", () => {
    const { tool, measures } = setup([]);
    click(tool, 1, 2);
    assert.deepEqual(measures, [], "no box after the first point");
    click(tool, 31, -38);
    assert.deepEqual(measures, [{
        mode: "single", length: "50 mm", dx: "30 mm", dy: "−40 mm",
        ax: "0 mm", ay: "0 mm", bx: "30 mm", by: "−40 mm", points: 2
    }]);
});

test("the next click hides the box and starts a new measurement, the one after shows it again", () => {
    const { tool, measures } = setup([]);
    click(tool, 0, 0);
    click(tool, 30, 40);
    click(tool, 100, 100);
    assert.equal(measures.length, 2);
    assert.equal(measures.at(-1), null);
    click(tool, 100, 120);
    assert.equal(measures.at(-1).length, "20 mm");
    assert.deepEqual([measures.at(-1).ax, measures.at(-1).ay], ["100 mm", "100 mm"]);
});

test("Nodes only ignores the grid and picks only line ends", () => {
    const { tool, measures } = setup([{ x1: 3, y1: 4, x2: 103, y2: 4 }]);
    tool.setSnapMode("nodes");
    click(tool, 300, 300);
    click(tool, 50, 4);
    assert.deepEqual(measures, [], "clicks away from a node do nothing");
    click(tool, 20, 10);
    click(tool, 90, 20);
    assert.deepEqual(measures.at(-1), {
        mode: "single", length: "100 mm", dx: "100 mm", dy: "0 mm",
        ax: "3 mm", ay: "4 mm", bx: "103 mm", by: "4 mm", points: 2
    });
    tool.setSnapMode("grid");
    assert.throws(() => tool.setSnapMode("other"), /Unknown ruler snap mode/);
});

test("cancel, undo step, tool change and data change clear the measurement", () => {
    for (const stop of ["cancel", "undoStep", "deactivate", "dataChanged"]) {
        const { tool, measures } = setup([]);
        click(tool, 0, 0);
        click(tool, 10, 0);
        tool[stop]();
        assert.equal(measures.at(-1), null, stop);
        assert.equal(tool.cancel(), false, `${stop}: nothing left to cancel`);
    }
    const { tool, measures } = setup([]);
    click(tool, 0, 0);
    assert.equal(tool.cancel(), true, "a half-done measurement can be cancelled");
    assert.deepEqual(measures, []);
});

test("Add points continues the measurement: total length grows and the area appears from three points", () => {
    const { tool, measures } = setup([]);
    assert.equal(tool.addPoints(), false, "needs a two-point measurement first");
    click(tool, 0, 0);
    click(tool, 40, 0);
    assert.equal(tool.stop(), false, "Stop only applies while adding points");
    assert.equal(tool.addPoints(), true);
    assert.deepEqual(total(measures.at(-1)), { mode: "multi", length: "40 mm", area: null, points: 2 });

    click(tool, 40, 30);
    assert.deepEqual(total(measures.at(-1)), { mode: "multi", length: "70 mm", area: "600 mm²", points: 3 });
    click(tool, 0, 30);
    assert.deepEqual(total(measures.at(-1)), { mode: "multi", length: "110 mm", area: "1200 mm²", points: 4 });

    assert.equal(tool.undoStep(), true, "undo removes the last added point");
    assert.deepEqual(total(measures.at(-1)), { mode: "multi", length: "70 mm", area: "600 mm²", points: 3 });
    click(tool, 0, 30);

    assert.equal(tool.stop(), true);
    assert.deepEqual(total(measures.at(-1)), { mode: "done", length: "110 mm", area: "1200 mm²", points: 4 });
    assert.equal(tool.addPoints(), false);

    click(tool, 200, 200);
    assert.equal(measures.at(-1), null, "a click after the result starts over");
    click(tool, 210, 200);
    assert.equal(measures.at(-1).mode, "single");
});

test("area ignores winding direction and the shaded area is drawn while adding points", () => {
    const { tool, measures } = setup([]);
    click(tool, 0, 0);
    click(tool, 0, 30);
    tool.addPoints();
    click(tool, 40, 30);
    assert.equal(measures.at(-1).area, "600 mm²");

    const calls = [];
    const g = {};
    for (const m of ["beginPath", "moveTo", "lineTo", "closePath", "fill", "stroke", "setLineDash", "fillText", "arc", "strokeRect", "roundRect"]) {
        g[m] = (...args) => calls.push([m, ...args]);
    }
    g.measureText = text => ({ width: text.length * 7 });
    tool.draw(g, { dpr: 1, fx: false, toScreen: (x, y) => ({ x, y }) });
    assert.ok(calls.some(([m]) => m === "closePath"), "area is filled");
    const areaText = calls.find(([m, text]) => m === "fillText" && text === "600 mm²");
    assert.ok(areaText, "area is labelled on the board");
    assert.ok(Math.abs(areaText[2] - 40 / 3) < 1e-9 && Math.abs(areaText[3] - 20) < 1e-9, "label sits at the triangle's centroid");
    const angles = calls.filter(([m, text]) => m === "fillText" && text.endsWith("°")).map(([, text]) => text).sort();
    assert.deepEqual(angles, ["36.9°", "53.1°", "90°"], "each corner of the 30-40-50 triangle shows its angle");

    tool.cancel();
    assert.equal(measures.at(-1), null);
    const after = [];
    for (const m of Object.keys(g)) g[m] = (...args) => after.push([m, ...args]);
    tool.draw(g, { dpr: 1, fx: false, toScreen: (x, y) => ({ x, y }) });
    assert.equal(after.some(([m]) => m === "closePath"), false);
});

function triangle(tool) {
    click(tool, 0, 0);
    click(tool, 100, 0);
    tool.addPoints();
    click(tool, 100, 100);
    tool.stop();
}

function savedDrawing(tool, dpr = 1) {
    const texts = [];
    const circles = [];
    const view = { dpr, fx: false, toScreen: (x, y) => ({ x: 50 + x * 2, y: 400 - y * 2 }) };
    const g = {
        beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {},
        stroke() {}, setLineDash() {}, strokeRect() {}, roundRect() {},
        measureText: text => ({ width: text.length * 7 * dpr }),
        fillText: (text, x, y) => texts.push({ text, x: x / dpr, y: y / dpr }),
        arc(...args) { if (args[2] === 3.5 * dpr) circles.push({ args, color: this.fillStyle }); }
    };
    tool.drawSaved(g, view);
    return { texts, circles, view, g };
}

test("saving a finished measurement persists its points and clickable labels with blue circles", () => {
    const { tool, measures } = setup([]);
    triangle(tool);
    assert.equal(measures.at(-1).nodes.length, 3);
    assert.equal(bucket(MEASURES).items.length, 0, "Stop does not save automatically");
    tool.save();
    assert.equal(measures.at(-1), null);
    const [saved] = bucket(MEASURES).items;
    assert.deepEqual(saved.points, [
        { x: 0, y: 0, enabled: true }, { x: 100, y: 0, enabled: true }, { x: 100, y: 100, enabled: true }
    ]);
    tool.deactivate();
    for (const dpr of [1, 2]) {
        const { texts, circles } = savedDrawing(tool, dpr);
        assert.equal(circles.length, 3);
        assert.ok(circles.every(c => c.color === "#8fe3ff"));
        assert.ok(texts.some(t => t.text.endsWith("mm²")));
        assert.ok(texts.some(t => t.text.endsWith("°")));
        assert.ok(texts.some(t => t.text.endsWith(" mm")));
        for (const t of texts) assert.equal(tool.hitText(t.x, t.y), saved.id, t.text);
        assert.equal(tool.hitText(-1000, -1000), null);
    }
});

test("saved point edits are previews until Save, and disabled points can be restored", () => {
    const { tool, measures } = setup([]);
    triangle(tool);
    tool.save();
    const [saved] = bucket(MEASURES).items;
    tool.open(saved.id);
    assert.equal(measures.at(-1).saved, true);
    tool.togglePoint(1);
    assert.equal(measures.at(-1).points, 2);
    assert.equal(measures.at(-1).area, null);
    assert.equal(measures.at(-1).length, "141.421 mm", "remaining points connect in their original order");
    assert.equal(saved.points[1].enabled, true, "draft has not mutated the bucket");
    click(tool, 500, 500);
    assert.equal(measures.at(-1).nodes.length, 3, "canvas clicks do not discard saved edits");
    tool.cancel();
    tool.open(saved.id);
    assert.equal(measures.at(-1).points, 3, "Cancel leaves saved data alone");
    tool.togglePoint(1);
    tool.save();
    assert.equal(bucket(MEASURES).items.length, 1, "editing updates rather than duplicating");
    assert.equal(saved.points[1].enabled, false);
    tool.open(saved.id);
    tool.togglePoint(1);
    assert.equal(measures.at(-1).points, 3);
    tool.save();
    assert.equal(saved.points[1].enabled, true);
});

test("measurement saves and edits round-trip through project files and undo", () => {
    const { tool, measures } = setup([]);
    triangle(tool);
    tool.save();
    const [saved] = bucket(MEASURES).items;
    const text = serialize();
    tool.open(saved.id);
    tool.togglePoint(0);
    tool.save();
    assert.equal(bucket(MEASURES).items[0].points[0].enabled, false);
    assert.equal(undo(), true);
    tool.dataChanged();
    assert.equal(bucket(MEASURES).items[0].points[0].enabled, true);
    deserialize(text);
    tool.dataChanged();
    tool.open(saved.id);
    assert.equal(measures.at(-1).points, 3);
    assert.equal(measures.at(-1).area, "5000 mm²");
    assert.equal(measures.at(-1).saved, true);
});

test("saving rejects too few included points and invalid edit requests explicitly", () => {
    const { tool, measures } = setup([]);
    assert.throws(() => tool.save(), /at least two/);
    triangle(tool);
    tool.togglePoint(0);
    tool.togglePoint(1);
    assert.equal(measures.at(-1).points, 1);
    assert.throws(() => tool.save(), /at least two/);
    assert.equal(bucket(MEASURES).items.length, 0);
    tool.togglePoint(2);
    assert.equal(measures.at(-1).points, 0);
    tool.togglePoint(0);
    tool.togglePoint(1);
    tool.save();
    assert.equal(bucket(MEASURES).items.length, 1);
    assert.throws(() => tool.togglePoint(0), /Cannot toggle/);
    assert.throws(() => tool.open(-1), /Unknown measurement/);
});

test("multiple saved annotations remain visible, and the edit preview replaces only its original", () => {
    const { tool } = setup([]);
    triangle(tool);
    tool.save();
    const first = bucket(MEASURES).items[0].id;
    triangle(tool);
    tool.save();
    const second = bucket(MEASURES).items[1].id;
    assert.notEqual(first, second);
    assert.equal(savedDrawing(tool).circles.length, 6);
    tool.open(second);
    assert.equal(savedDrawing(tool).circles.length, 3, "hide the original while its draft is on the board");
    tool.deactivate();
    assert.equal(savedDrawing(tool).circles.length, 6, "leaving Ruler restores the saved version");
    assert.equal(undo(), true);
    tool.dataChanged();
    assert.equal(bucket(MEASURES).items.length, 1, "undo removes only the last saved annotation");
    deserialize('{"app":"ajxcad","format":1,"buckets":[]}');
    tool.dataChanged();
    assert.equal(savedDrawing(tool).circles.length, 0, "older projects without a measures bucket still load");
});

test("display checkboxes preview and persist lengths, angles and area independently", () => {
    const { tool, measures } = setup([]);
    triangle(tool);
    assert.equal(measures.at(-1).showLengths, true);
    assert.equal(measures.at(-1).showAngles, true);
    assert.equal(measures.at(-1).showArea, true);
    tool.save();
    const [item] = bucket(MEASURES).items;
    const categories = [
        ["showLengths", text => text.endsWith(" mm")],
        ["showAngles", text => text.endsWith("°")],
        ["showArea", text => text.endsWith("mm²")]
    ];
    for (const [option, matches] of categories) {
        tool.open(item.id);
        tool.toggleDisplay(option);
        assert.equal(measures.at(-1)[option], false);
        const { g, view, texts } = savedDrawing(tool);
        tool.draw(g, view);
        assert.equal(texts.some(t => matches(t.text)), false, "preview hides unchecked data");
        assert.equal(item[option], true, "draft does not change saved settings");
        tool.save();
        const savedTexts = savedDrawing(tool).texts;
        assert.equal(savedTexts.some(t => matches(t.text)), false);
        for (const [other, visible] of categories) {
            if (other !== option) assert.ok(savedTexts.some(t => visible(t.text)), other);
        }
        deserialize(serialize());
        tool.open(item.id);
        assert.equal(measures.at(-1)[option], false, "settings survive project reload");
        tool.toggleDisplay(option);
        tool.save();
    }
    assert.throws(() => tool.toggleDisplay("showArea"), /Cannot toggle/);
    tool.open(item.id);
    assert.throws(() => tool.toggleDisplay("unknown"), /Cannot toggle/);
    tool.toggleDisplay("showArea");
    tool.cancel();
    tool.open(item.id);
    assert.equal(measures.at(-1).showArea, true, "Cancel discards display changes");
    tool.cancel();
});

test("all labels may be hidden and blue circles do not open the measurement editor", () => {
    const { tool, measures } = setup([]);
    triangle(tool);
    for (const option of ["showLengths", "showAngles", "showArea"]) tool.toggleDisplay(option);
    tool.save();
    const [item] = bucket(MEASURES).items;
    const { texts, circles } = savedDrawing(tool, 2);
    assert.equal(texts.length, 0);
    assert.equal(circles.length, 3);
    assert.equal(tool.hitText(50, 400), null);
    tool.open(item.id);
    assert.equal(measures.at(-1).showArea, false);
    tool.cancel();
    assert.equal(undo(), true, "save with display settings is undoable");
    assert.equal(bucket(MEASURES).items.length, 0);
});

test("older saved measurements default to all data visible", () => {
    const { tool, measures } = setup([]);
    bucket(MEASURES).items = [{ id: 100, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }];
    assert.equal(savedDrawing(tool).texts.length, 6);
    tool.open(100);
    for (const option of ["showLengths", "showAngles", "showArea"]) assert.equal(measures.at(-1)[option], true);
});

test("deleting one saved measurement clears its editor, preserves other data, and is undoable", () => {
    const { tool, measures } = setup([{ x1: 500, y1: 500, x2: 600, y2: 500 }]);
    triangle(tool);
    tool.save();
    triangle(tool);
    tool.save();
    const before = structuredClone(bucket(MEASURES).items);
    const drawing = structuredClone(lines.items);
    tool.open(before[0].id);
    assert.equal(tool.selectedMeasurementId(), before[0].id);
    tool.togglePoint(1);
    tool.deleteMeasurement(before[0].id);
    assert.equal(measures.at(-1), null);
    assert.equal(tool.selectedMeasurementId(), null);
    assert.deepEqual(bucket(MEASURES).items, [before[1]]);
    assert.deepEqual(lines.items, drawing);
    assert.equal(tool.hitText(50, 400), null);
    assert.equal(savedDrawing(tool).circles.length, 3);
    assert.equal(tool.undoStep(), false, "no active draft intercepts undo");
    assert.equal(undo(), true);
    tool.dataChanged();
    assert.deepEqual(bucket(MEASURES).items, before);
    assert.deepEqual(lines.items, drawing);
    assert.equal(savedDrawing(tool).circles.length, 6);
});

test("deletion rejects unknown measurements and preserves an unrelated draft", () => {
    const { tool, measures } = setup([]);
    triangle(tool);
    tool.save();
    const id = bucket(MEASURES).items[0].id;
    triangle(tool);
    const draft = structuredClone(measures.at(-1));
    assert.equal(tool.selectedMeasurementId(), null);
    assert.throws(() => tool.deleteMeasurement(-1), /Unknown measurement/);
    assert.equal(bucket(MEASURES).items.length, 1);
    tool.deleteMeasurement(id);
    assert.deepEqual(measures.at(-1), draft);
    assert.equal(bucket(MEASURES).items.length, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { bucket } from "../wwwroot/cad/store.js";
import { createRulerTool } from "../wwwroot/cad/tools/ruler.js";

const lines = bucket("lines");

function setup(items) {
    lines.items = items.map((line, id) => ({ id: id + 1, ...line }));
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
    assert.deepEqual(measures.at(-1), { mode: "multi", length: "40 mm", area: null, points: 2 });

    click(tool, 40, 30);
    assert.deepEqual(measures.at(-1), { mode: "multi", length: "70 mm", area: "600 mm²", points: 3 });
    click(tool, 0, 30);
    assert.deepEqual(measures.at(-1), { mode: "multi", length: "110 mm", area: "1200 mm²", points: 4 });

    assert.equal(tool.undoStep(), true, "undo removes the last added point");
    assert.deepEqual(measures.at(-1), { mode: "multi", length: "70 mm", area: "600 mm²", points: 3 });
    click(tool, 0, 30);

    assert.equal(tool.stop(), true);
    assert.deepEqual(measures.at(-1), { mode: "done", length: "110 mm", area: "1200 mm²", points: 4 });
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

    tool.cancel();
    assert.equal(measures.at(-1), null);
    const after = [];
    for (const m of Object.keys(g)) g[m] = (...args) => after.push([m, ...args]);
    tool.draw(g, { dpr: 1, fx: false, toScreen: (x, y) => ({ x, y }) });
    assert.equal(after.some(([m]) => m === "closePath"), false);
});

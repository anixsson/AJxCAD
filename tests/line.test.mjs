import test from "node:test";
import assert from "node:assert/strict";
import { bucket, undo } from "../wwwroot/cad/store.js";
import { createLineTool } from "../wwwroot/cad/tools/line.js";

const lines = bucket("lines");

function setup(extra = {}) {
    lines.items = [];
    const logs = [];
    const tool = createLineTool({
        snap: (x, y) => ({ x, y, kind: "grid" }),
        toWorld: (x, y) => ({ x, y }),
        minorStepMm: () => 1,
        formatLength: mm => `${mm} mm`,
        log: (kind, text) => logs.push({ kind, text }),
        redraw() {},
        setTool() {},
        ...extra
    });
    return { tool, logs };
}

const click = (tool, sx, sy) => tool.pointerDown({ sx, sy, shift: false, detail: 1 });
const geometry = () => lines.items.map(l => [l.x1, l.y1, l.x2, l.y2]);

test("Space ends the line chain so the next click starts a new line", () => {
    const { tool, logs } = setup();
    assert.equal(tool.space(), false, "nothing to end before the first click");

    click(tool, 0, 0);
    click(tool, 10, 0);
    click(tool, 10, 10);
    assert.deepEqual(geometry(), [[0, 0, 10, 0], [10, 0, 10, 10]]);

    assert.equal(tool.space(), true);
    assert.equal(logs.at(-1).text, "line chain ended");
    assert.equal(lines.items.length, 2, "placed lines stay");

    click(tool, 50, 50);
    assert.equal(lines.items.length, 2, "the first click after Space only sets a new start");
    click(tool, 60, 50);
    assert.deepEqual(geometry().at(-1), [50, 50, 60, 50]);
    assert.equal(tool.space(), true);
    assert.equal(tool.space(), false);
});

test("with Multi off each line ends after its second click", () => {
    const { tool } = setup();
    tool.setMulti(false);
    click(tool, 0, 0);
    click(tool, 10, 0);
    click(tool, 10, 10);
    assert.deepEqual(geometry(), [[0, 0, 10, 0]], "the third click starts a new line instead of chaining");
    click(tool, 20, 10);
    assert.deepEqual(geometry(), [[0, 0, 10, 0], [10, 10, 20, 10]]);
    assert.equal(tool.space(), false, "no chain left to end");

    tool.setMulti(true);
    click(tool, 0, 50);
    click(tool, 10, 50);
    click(tool, 20, 50);
    assert.equal(lines.items.length, 4, "Multi on chains again");
});

test("exact length follows the preview direction, bypasses grid rounding and chains with undo", () => {
    const { tool } = setup();
    click(tool, 10, 20);
    tool.pointerMove({ sx: -20, sy: 60 });
    tool.pointerLeave();
    assert.equal(tool.placeLength(12.5), true);
    assert.deepEqual(geometry(), [[10, 20, 2.5, 30]]);
    tool.pointerMove({ sx: 2.5, sy: -10 });
    assert.equal(tool.placeLength(7.25), true);
    assert.deepEqual(geometry().at(-1), [2.5, 30, 2.5, 22.75]);
    assert.equal(tool.undoStep(), true);
    assert.equal(undo(), true);
    assert.deepEqual(geometry(), [[10, 20, 2.5, 30]]);
});

test("exact length respects Shift direction and single-line mode", () => {
    const { tool } = setup({ gridSnapEnabled: () => false });
    tool.setMulti(false);
    click(tool, 0, 0);
    tool.pointerMove({ sx: 30, sy: 20, shift: true });
    assert.equal(tool.placeLength(10), true);
    const line = lines.items[0];
    assert.ok(Math.abs(line.x2 - Math.SQRT1_2 * 10) < 1e-10);
    assert.ok(Math.abs(line.y2 - Math.SQRT1_2 * 10) < 1e-10);
    assert.equal(tool.space(), false);
    click(tool, 50, 50);
    assert.equal(lines.items.length, 1);
});

test("exact length requires a positive finite length and a nonzero direction", () => {
    const { tool, logs } = setup();
    assert.equal(tool.placeLength(10), false);
    click(tool, 0, 0);
    for (const value of [0, -1, NaN, Infinity, "10"]) {
        assert.throws(() => tool.placeLength(value), /positive, finite/);
    }
    assert.equal(tool.placeLength(10), false);
    assert.equal(logs.at(-1).kind, "error");
    assert.equal(lines.items.length, 0);
    tool.pointerMove({ sx: 10, sy: 0 });
    assert.equal(tool.placeLength(3.125), true);
    assert.deepEqual(geometry(), [[0, 0, 3.125, 0]]);
});

test("length field follows the cursor and clears on chain cancellation and project changes", () => {
    const changes = [];
    const { tool } = setup({ lineLengthChanged: state => changes.push(state) });
    tool.pointerMove({ sx: 20, sy: 30 });
    assert.equal(changes.at(-1), null);
    for (const finish of ["space", "undoStep", "deactivate", "dataChanged"]) {
        click(tool, 0, 0);
        tool.pointerMove({ sx: 20, sy: 30 });
        assert.deepEqual(changes.at(-1), { sx: 20, sy: 30, x: 0, y: 0 });
        tool[finish]();
        assert.equal(changes.at(-1), null);
    }
    click(tool, 0, 0);
    tool.setMulti(false);
    assert.equal(changes.at(-1), null);
});

test("Direct add toggles length entry without cancelling the pending segment", () => {
    const changes = [];
    const { tool, logs } = setup({ lineLengthChanged: state => changes.push(state) });
    click(tool, 10, 20);
    tool.pointerMove({ sx: 40, sy: 60 });
    tool.setDirectAdd(false);
    assert.equal(changes.at(-1), null);
    assert.equal(tool.placeLength(10), false);
    assert.equal(logs.at(-1).kind, "error");
    assert.equal(lines.items.length, 0);
    tool.setDirectAdd(true);
    assert.deepEqual(changes.at(-1), { sx: 40, sy: 60, x: 10, y: 20 });
    assert.equal(tool.placeLength(10), true);
    assert.deepEqual(geometry(), [[10, 20, 16, 28]]);
    tool.setDirectAdd(false);
    click(tool, 30, 40);
    assert.deepEqual(geometry().at(-1), [16, 28, 30, 40], "click placement is unaffected");
    assert.throws(() => tool.setDirectAdd("false"), /checkbox/);
    tool.deactivate();
    click(tool, 0, 0);
    assert.equal(changes.at(-1), null, "the option persists across tool deactivation");
});

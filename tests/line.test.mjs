import test from "node:test";
import assert from "node:assert/strict";
import { bucket } from "../wwwroot/cad/store.js";
import { createLineTool } from "../wwwroot/cad/tools/line.js";

const lines = bucket("lines");

function setup() {
    lines.items = [];
    const logs = [];
    const tool = createLineTool({
        snap: (x, y) => ({ x, y, kind: "grid" }),
        toWorld: (x, y) => ({ x, y }),
        minorStepMm: () => 1,
        formatLength: mm => `${mm} mm`,
        log: (kind, text) => logs.push({ kind, text }),
        redraw() {},
        setTool() {}
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

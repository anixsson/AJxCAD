import test from "node:test";
import assert from "node:assert/strict";
import { bucket } from "../wwwroot/cad/store.js";
import { createSelectTool } from "../wwwroot/cad/tools/select.js";

const lines = bucket("lines");

function setup(items) {
    lines.items = items.map((line, id) => ({ id: id + 1, ...line }));
    const logs = [];
    const tool = createSelectTool({
        geometries: [{
            bucket: "lines",
            points: line => [
                { key: "a", x: line.x1, y: line.y1 },
                { key: "b", x: line.x2, y: line.y2 }
            ],
            setPoint(line, key, x, y) {
                if (key === "a") { line.x1 = x; line.y1 = y; }
                else { line.x2 = x; line.y2 = y; }
            }
        }],
        toWorld: (x, y) => ({ x, y }),
        toScreen: (x, y) => ({ x, y }),
        snap: (x, y) => ({ x, y, kind: "grid" }),
        capture() {},
        redraw() {},
        log: (kind, text) => logs.push({ kind, text })
    });
    return { tool, logs };
}

const pointer = (sx, sy, options = {}) => ({
    sx, sy, shift: false, control: false, pointerId: 1, ...options
});

test("dragging empty space selects enclosed line ends and Shift-drag adds to selection", () => {
    const { tool, logs } = setup([
        { x1: 0, y1: 0, x2: 10, y2: 0 },
        { x1: 10, y1: 0, x2: 10, y2: 10 },
        { x1: 30, y1: 30, x2: 35, y2: 30 }
    ]);

    tool.pointerDown(pointer(-20, -20));
    tool.pointerMove(pointer(11, 1));
    tool.pointerUp(pointer(11, 1));
    assert.equal(logs.at(-1).text, "selected 3 line ends");

    tool.pointerDown(pointer(20, 20, { shift: true }));
    tool.pointerMove(pointer(36, 31, { shift: true }));
    tool.pointerUp(pointer(36, 31, { shift: true }));
    assert.equal(logs.at(-1).text, "selected 5 line ends");

    tool.pointerDown(pointer(19, 19, { shift: true, control: true }));
    tool.pointerMove(pointer(31, 31, { shift: true, control: true }));
    tool.pointerUp(pointer(31, 31, { shift: true, control: true }));
    assert.equal(logs.at(-1).text, "selected 4 line ends");
});

test("clicking empty space still clears selection and dragging a selected node still moves it", () => {
    const { tool, logs } = setup([
        { x1: 0, y1: 0, x2: 10, y2: 0 },
        { x1: 10, y1: 0, x2: 10, y2: 10 }
    ]);

    tool.pointerDown(pointer(-20, -20));
    tool.pointerMove(pointer(11, 1));
    tool.pointerUp(pointer(11, 1));
    tool.pointerDown(pointer(0, 0));
    tool.pointerMove(pointer(2, 3));
    tool.pointerUp(pointer(2, 3));

    assert.deepEqual(
        lines.items.map(({ x1, y1, x2, y2 }) => [x1, y1, x2, y2]),
        [[2, 3, 12, 3], [12, 3, 10, 10]]
    );

    tool.pointerDown(pointer(50, 50));
    tool.pointerUp(pointer(50, 50));
    assert.equal(logs.at(-1).text, "selected 0 line ends");
});

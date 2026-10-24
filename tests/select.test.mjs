import test from "node:test";
import assert from "node:assert/strict";
import { bucket, undo } from "../wwwroot/cad/store.js";
import { createSelectTool } from "../wwwroot/cad/tools/select.js";

const lines = bucket("lines");

function setup(items, overrides = {}) {
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
        log: (kind, text) => logs.push({ kind, text }),
        formatLength: mm => `${mm} mm`,
        ...overrides
    });
    return { tool, logs };
}

const pointer = (sx, sy, options = {}) => ({
    sx, sy, shift: false, control: false, pointerId: 1, ...options
});

function draw(tool, { dpr = 1, fx = false, toScreen = (x, y) => ({ x, y }) } = {}) {
    const calls = [];
    const strokes = [];
    let path = [];
    const g = {};
    for (const method of ["fillRect", "strokeRect", "setLineDash", "beginPath", "moveTo", "lineTo", "stroke", "fillText"]) {
        g[method] = (...args) => {
            calls.push([method, ...args]);
            if (method === "beginPath") path = [];
            if (method === "moveTo" || method === "lineTo") path.push([method, ...args]);
            if (method === "stroke") strokes.push({ style: g.strokeStyle, path: [...path] });
        };
    }
    tool.draw(g, { dpr, fx, toScreen, width: 1000, height: 1000 });
    return { calls, strokes, g };
}

const highlightedPath = tool => draw(tool).strokes.filter(s => s.style === "#ff8fe0").flatMap(s => s.path);
const hasMoveGuide = tool => draw(tool).calls.some(([method, dash]) =>
    method === "setLineDash" && dash[0] === 6
);

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

test("moving selected ends draws a dashed guide from the original corner with the snapped offset", () => {
    const lengths = [];
    const { tool } = setup([{ x1: 0, y1: 0, x2: 20, y2: 0 }], {
        snap: () => ({ x: -3, y: 4, kind: "end" }),
        formatLength: mm => {
            lengths.push(mm);
            return `${mm / 25.4} in`;
        }
    });
    tool.pointerDown(pointer(1, 1));
    assert.equal(draw(tool).calls.some(([method]) => method === "fillText"), false);
    tool.pointerMove(pointer(2, 2));
    assert.equal(draw(tool).calls.some(([method]) => method === "fillText"), false);
    tool.pointerMove(pointer(-4, 6));

    const { calls, g } = draw(tool, {
        dpr: 2,
        fx: true,
        toScreen: (x, y) => ({ x: 100 + x * 10, y: 100 - y * 10 })
    });
    assert.deepEqual(calls.slice(calls.findIndex(([method]) => method === "setLineDash")).filter(([method]) =>
        ["setLineDash", "beginPath", "moveTo", "lineTo", "stroke", "fillText"].includes(method)
    ), [
        ["setLineDash", [12, 10]],
        ["beginPath"],
        ["moveTo", 200, 200],
        ["lineTo", 140, 120],
        ["stroke"],
        ["setLineDash", []],
        ["fillText", `Offset ${5 / 25.4} in`, 186, 144]
    ]);
    assert.deepEqual(lengths, [5]);
    assert.equal(g.shadowBlur, 0);
    assert.deepEqual([lines.items[0].x1, lines.items[0].y1], [-3, 4]);

    tool.pointerMove(pointer(-8, 9));
    assert.deepEqual(draw(tool).calls.find(([method]) => method === "moveTo"), ["moveTo", 0, 0]);
    tool.pointerUp(pointer(-8, 9));
    assert.equal(draw(tool).calls.some(([method]) => method === "fillText"), false);
    assert.equal(hasMoveGuide(tool), false);
});

test("move feedback shows zero offset on returning to the start and clears on reset", () => {
    for (const reset of ["dataChanged", "deactivate"]) {
        const { tool } = setup([{ x1: 0, y1: 0, x2: 20, y2: 0 }]);
        tool.pointerDown(pointer(0, 0));
        tool.pointerMove(pointer(3, 4));
        assert.ok(draw(tool).calls.some(([method, text]) => method === "fillText" && text === "Offset 5 mm"));
        tool.pointerMove(pointer(0, 0));
        assert.ok(draw(tool).calls.some(([method, text]) => method === "fillText" && text === "Offset 0 mm"));
        tool[reset]();
        assert.equal(draw(tool).calls.some(([method]) => method === "fillText"), false);
        assert.equal(hasMoveGuide(tool), false);
    }
});

test("marquee selection retains its dashed rectangle without move feedback", () => {
    const { tool } = setup([{ x1: 0, y1: 0, x2: 20, y2: 0 }]);
    tool.pointerDown(pointer(-20, -20));
    tool.pointerMove(pointer(30, 30));
    const { calls } = draw(tool);
    assert.ok(calls.some(([method, x, y, width, height]) =>
        method === "strokeRect" && x === -20 && y === -20 && width === 50 && height === 50
    ));
    assert.equal(calls.some(([method]) => method === "fillText"), false);
    assert.equal(hasMoveGuide(tool), false);
});

test("Lines mode selects both ends and shared corners, and dragging moves them together", () => {
    const { tool } = setup([
        { x1: 0, y1: 0, x2: 100, y2: 0 },
        { x1: 100, y1: 0, x2: 100, y2: 100 }
    ]);
    tool.setSelectionMode("lines");
    tool.pointerDown(pointer(50, 0));
    tool.pointerUp(pointer(50, 0));
    assert.deepEqual(highlightedPath(tool), [["moveTo", 0, 0], ["lineTo", 100, 0]]);
    tool.pointerDown(pointer(50, 0));
    tool.pointerMove(pointer(53, 4));
    assert.deepEqual(lines.items.map(l => [l.x1, l.y1, l.x2, l.y2]), [
        [3, 4, 103, 4], [103, 4, 100, 100]
    ]);
    assert.equal(hasMoveGuide(tool), true);
    tool.pointerUp(pointer(53, 4));
    assert.equal(hasMoveGuide(tool), false);
    assert.equal(undo(), true);
    tool.dataChanged();
    assert.deepEqual(lines.items.map(l => [l.x1, l.y1, l.x2, l.y2]), [
        [0, 0, 100, 0], [100, 0, 100, 100]
    ]);
    assert.deepEqual(draw(tool).strokes.flatMap(s => s.path), []);
});

test("Lines mode respects Shift add, toggle and explicit removal, highlighting lines between selected ends", () => {
    const { tool, logs } = setup([
        { x1: 0, y1: 0, x2: 100, y2: 0 },
        { x1: 100, y1: 0, x2: 200, y2: 0 },
        { x1: 200, y1: 0, x2: 300, y2: 0 }
    ]);
    tool.setSelectionMode("lines");
    const click = (x, options = {}) => {
        tool.pointerDown(pointer(x, 0, options));
        tool.pointerUp(pointer(x, 0, options));
    };
    click(50);
    click(250, { shift: true });
    assert.equal(highlightedPath(tool).length, 6);
    assert.equal(logs.at(-1).text, "selected 6 line ends");
    click(250, { shift: true });
    assert.equal(highlightedPath(tool).length, 2);
    click(50, { shift: true, control: true });
    assert.deepEqual(highlightedPath(tool), []);
    assert.equal(logs.at(-1).text, "selected 0 line ends");
    click(250);
    click(50);
    assert.deepEqual(highlightedPath(tool), [["moveTo", 0, 0], ["lineTo", 100, 0]]);
    tool.pointerDown(pointer(400, 100));
    tool.pointerUp(pointer(400, 100));
    assert.deepEqual(highlightedPath(tool), []);
});

test("Nodes remains the default, selected endpoints highlight their line, and mode changes keep selection", () => {
    const { tool } = setup([{ x1: 0, y1: 0, x2: 100, y2: 0 }]);
    tool.pointerDown(pointer(50, 0));
    tool.pointerUp(pointer(50, 0));
    assert.deepEqual(highlightedPath(tool), []);
    tool.pointerDown(pointer(0, 0));
    tool.pointerUp(pointer(0, 0));
    tool.pointerDown(pointer(100, 0, { shift: true }));
    tool.pointerUp(pointer(100, 0, { shift: true }));
    assert.equal(highlightedPath(tool).length, 2);
    tool.setSelectionMode("lines");
    assert.equal(highlightedPath(tool).length, 2);
    tool.setSelectionMode("nodes");
    assert.equal(highlightedPath(tool).length, 2);
    tool.dataChanged();
    assert.deepEqual(highlightedPath(tool), []);
    assert.throws(() => tool.setSelectionMode("invalid"), /Unknown selection mode/);
});

test("line picking uses screen-space segment distance, chooses the nearest line, and previews hover", () => {
    const { tool, logs } = setup([
        { x1: 0, y1: 0, x2: 100, y2: 0 },
        { x1: 0, y1: 20, x2: 100, y2: 20 }
    ], {
        toScreen: (x, y) => ({ x: x * 2, y: y * 2 }),
        toWorld: (x, y) => ({ x: x / 2, y: y / 2 })
    });
    tool.setSelectionMode("lines");
    tool.pointerMove(pointer(100, 9));
    assert.deepEqual(draw(tool).strokes.find(s => s.style === "#8fe3ff").path, [["moveTo", 0, 0], ["lineTo", 100, 0]]);
    assert.deepEqual(highlightedPath(tool), []);
    tool.pointerLeave();
    assert.deepEqual(highlightedPath(tool), []);
    tool.pointerDown(pointer(100, 31));
    tool.pointerUp(pointer(100, 31));
    assert.deepEqual(highlightedPath(tool), [["moveTo", 0, 20], ["lineTo", 100, 20]]);
    assert.equal(logs.at(-1).text, "selected 2 line ends");
    tool.pointerDown(pointer(211, 40));
    tool.pointerUp(pointer(211, 40));
    assert.equal(logs.at(-1).text, "selected 0 line ends");
});

test("rectangle selection still selects enclosed ends in Lines mode", () => {
    const { tool } = setup([{ x1: 0, y1: 0, x2: 100, y2: 0 }]);
    tool.setSelectionMode("lines");
    tool.pointerDown(pointer(-20, -20));
    tool.pointerMove(pointer(120, 20));
    tool.pointerUp(pointer(120, 20));
    assert.equal(highlightedPath(tool).length, 2);
    tool.deactivate();
    assert.deepEqual(highlightedPath(tool), []);
});

test("line picking handles diagonal and zero-length lines without extending past the segment", () => {
    const { tool, logs } = setup([
        { x1: 0, y1: 0, x2: 100, y2: 100 },
        { x1: 200, y1: 200, x2: 200, y2: 200 }
    ]);
    tool.setSelectionMode("lines");
    tool.pointerDown(pointer(50, 55));
    tool.pointerUp(pointer(50, 55));
    assert.deepEqual(highlightedPath(tool), [["moveTo", 0, 0], ["lineTo", 100, 100]]);
    tool.pointerDown(pointer(111, 111));
    tool.pointerUp(pointer(111, 111));
    assert.equal(logs.at(-1).text, "selected 0 line ends");
    tool.pointerDown(pointer(200, 200));
    tool.pointerUp(pointer(200, 200));
    assert.equal(logs.at(-1).text, "selected 2 line ends");
    assert.deepEqual(highlightedPath(tool), [["moveTo", 200, 200], ["lineTo", 200, 200]]);
});

test("dragging a line starts from the nearest grid point so moves stay in grid steps", () => {
    const grid = (x, y, exclude) => {
        if (!exclude) throw new Error("grid anchor must exclude endpoints");
        return { x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10, kind: "grid" };
    };
    const { tool } = setup([{ x1: 0, y1: 0, x2: 100, y2: 0 }], { snap: grid });
    tool.setSelectionMode("lines");
    tool.pointerDown(pointer(43, 2));
    tool.pointerMove(pointer(68, 18));
    assert.deepEqual([lines.items[0].x1, lines.items[0].y1, lines.items[0].x2, lines.items[0].y2], [30, 20, 130, 20]);
    const { calls } = draw(tool);
    const guide = calls.findIndex(([method, dash]) => method === "setLineDash" && dash[0] === 6);
    assert.deepEqual(calls[guide + 2], ["moveTo", 40, 0]);
    assert.ok(calls.some(([method, text]) => method === "fillText" && text === `Offset ${Math.hypot(30, 20)} mm`));
    tool.pointerUp(pointer(68, 18));
});

function setupWithEvents(items) {
    const events = [];
    const result = setup(items, {
        selectionChanged: count => events.push(["selection", count]),
        processChanged: state => events.push(["process", state])
    });
    return { ...result, events };
}

const click = (tool, x, y, options) => {
    tool.pointerDown(pointer(x, y, options));
    tool.pointerUp(pointer(x, y, options));
};

test("selection count is reported when it changes, including clears", () => {
    const { tool, events } = setupWithEvents([{ x1: 0, y1: 0, x2: 100, y2: 0 }]);
    tool.setSelectionMode("lines");
    click(tool, 50, 0);
    click(tool, 50, 0);
    click(tool, 300, 300);
    assert.deepEqual(events, [["selection", 2], ["selection", 0]]);
    click(tool, 50, 0);
    tool.deactivate();
    assert.deepEqual(events.slice(2), [["selection", 2], ["selection", 0]]);
});

test("guided Move: pick base, Next, pick destination moves the whole selection once and is undoable", () => {
    const { tool, events } = setupWithEvents([
        { x1: 0, y1: 0, x2: 100, y2: 0 },
        { x1: 100, y1: 0, x2: 100, y2: 100 },
        { x1: 500, y1: 500, x2: 600, y2: 500 }
    ]);
    tool.setSelectionMode("lines");
    click(tool, 50, 0);
    assert.equal(tool.confirmMoveBase(), false);
    assert.equal(tool.startMove(), true);
    assert.deepEqual(events.at(-1), ["process", { step: "base", hasBase: false }]);
    assert.equal(tool.confirmMoveBase(), false, "Next needs a base point");

    // In a process, clicks pick points instead of changing the selection.
    click(tool, 100, 0);
    assert.deepEqual(events.at(-1), ["process", { step: "base", hasBase: true }]);
    click(tool, 0, 0);
    assert.equal(tool.confirmMoveBase(), true);
    assert.deepEqual(events.at(-1), ["process", { step: "target", hasBase: true }]);

    tool.pointerMove(pointer(20, 30));
    const preview = draw(tool).calls;
    assert.ok(preview.some(([method, text]) => method === "fillText" && text === `Offset ${Math.hypot(20, 30)} mm`));
    assert.deepEqual(lines.items[0], { id: 1, x1: 0, y1: 0, x2: 100, y2: 0 }, "preview does not change data");

    click(tool, 20, 30);
    assert.deepEqual(lines.items.map(l => [l.x1, l.y1, l.x2, l.y2]), [
        [20, 30, 120, 30], [120, 30, 100, 100], [500, 500, 600, 500]
    ]);
    assert.equal(events.at(-1)[1], null);
    assert.equal(highlightedPath(tool).length, 2, "selection is kept after moving");

    assert.equal(undo(), true);
    assert.deepEqual(lines.items.map(l => [l.x1, l.y1, l.x2, l.y2]), [
        [0, 0, 100, 0], [100, 0, 100, 100], [500, 500, 600, 500]
    ]);
});

test("Move cannot start without a selection and is cancelled by cancel, undo step, tool change and data change", () => {
    const { tool, events } = setupWithEvents([{ x1: 0, y1: 0, x2: 100, y2: 0 }]);
    assert.equal(tool.startMove(), false);
    tool.setSelectionMode("lines");
    for (const stop of ["cancelProcess", "undoStep", "deactivate", "dataChanged"]) {
        click(tool, 50, 0);
        assert.equal(tool.startMove(), true);
        click(tool, 0, 0);
        tool[stop]();
        assert.equal(events.at(-1 - (stop === "deactivate" || stop === "dataChanged" ? 1 : 0))[1], null, stop);
        assert.equal(tool.cancelProcess(), false);
        assert.deepEqual(lines.items[0], { id: 1, x1: 0, y1: 0, x2: 100, y2: 0 });
    }
    assert.equal(tool.undoStep(), false);
});

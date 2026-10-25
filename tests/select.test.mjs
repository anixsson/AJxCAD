import test from "node:test";
import assert from "node:assert/strict";
import { bucket, undo, newId } from "../wwwroot/cad/store.js";
import { createSelectTool } from "../wwwroot/cad/tools/select.js";
import { lineGeometry } from "../wwwroot/cad/lines.js";
import { MEASURES, measurementGeometry } from "../wwwroot/cad/tools/measurement.js";

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
            },
            split(line, x, y) {
                const added = { id: newId() + 1000, x1: x, y1: y, x2: line.x2, y2: line.y2 };
                lines.items.push(added);
                line.x2 = x;
                line.y2 = y;
                return { added, joint: [{ item: line, key: "b" }, { item: added, key: "a" }] };
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
    for (const method of ["fillRect", "strokeRect", "setLineDash", "beginPath", "moveTo", "lineTo", "stroke", "fillText", "closePath", "fill", "roundRect", "arc"]) {
        g[method] = (...args) => {
            calls.push([method, ...args]);
            if (method === "beginPath") path = [];
            if (method === "moveTo" || method === "lineTo") path.push([method, ...args]);
            if (method === "stroke") strokes.push({ style: g.strokeStyle, path: [...path] });
        };
    }
    g.measureText = text => ({ width: text.length * 7 });
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
    assert.equal(logs.at(-1).text, "selected 3 drawing points");

    tool.pointerDown(pointer(20, 20, { shift: true }));
    tool.pointerMove(pointer(36, 31, { shift: true }));
    tool.pointerUp(pointer(36, 31, { shift: true }));
    assert.equal(logs.at(-1).text, "selected 5 drawing points");

    tool.pointerDown(pointer(19, 19, { shift: true, control: true }));
    tool.pointerMove(pointer(31, 31, { shift: true, control: true }));
    tool.pointerUp(pointer(31, 31, { shift: true, control: true }));
    assert.equal(logs.at(-1).text, "selected 4 drawing points");
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
    assert.equal(logs.at(-1).text, "selected 0 drawing points");
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
    tool.pointerDown(pointer(30, 0));
    tool.pointerMove(pointer(33, 4));
    assert.deepEqual(lines.items.map(l => [l.x1, l.y1, l.x2, l.y2]), [
        [3, 4, 103, 4], [103, 4, 100, 100]
    ]);
    assert.equal(hasMoveGuide(tool), true);
    tool.pointerUp(pointer(33, 4));
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
    assert.equal(logs.at(-1).text, "selected 6 drawing points");
    click(250, { shift: true });
    assert.equal(highlightedPath(tool).length, 2);
    click(50, { shift: true, control: true });
    assert.deepEqual(highlightedPath(tool), []);
    assert.equal(logs.at(-1).text, "selected 0 drawing points");
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
    assert.equal(logs.at(-1).text, "selected 2 drawing points");
    tool.pointerDown(pointer(211, 40));
    tool.pointerUp(pointer(211, 40));
    assert.equal(logs.at(-1).text, "selected 0 drawing points");
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
    assert.equal(logs.at(-1).text, "selected 0 drawing points");
    tool.pointerDown(pointer(200, 200));
    tool.pointerUp(pointer(200, 200));
    assert.equal(logs.at(-1).text, "selected 2 drawing points");
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

const handlesDrawn = tool => draw(tool).calls.filter(([method]) => method === "closePath").length;
const geometry = () => lines.items.map(l => [l.x1, l.y1, l.x2, l.y2]);

test("dragging the midpoint handle of a selected line splits it and moves the new shared node", () => {
    const { tool, logs, events } = setupWithEvents([
        { x1: 0, y1: 0, x2: 100, y2: 0 },
        { x1: 100, y1: 0, x2: 100, y2: 100 }
    ]);
    tool.setSelectionMode("lines");
    assert.equal(handlesDrawn(tool), 0, "no handle without a selection");
    click(tool, 30, 0);
    assert.equal(handlesDrawn(tool), 1, "the selected line shows its midpoint handle");

    tool.pointerDown(pointer(51, 1));
    tool.pointerMove(pointer(52, 1));
    assert.equal(lines.items.length, 2, "nothing happens until the drag starts");
    tool.pointerMove(pointer(50, 30));

    assert.deepEqual(geometry(), [
        [0, 0, 50, 30], [100, 0, 100, 100], [50, 30, 100, 0]
    ], "two lines meet at the moved node; the far end stays joined to the other line");
    assert.equal(logs.at(-1).text, "split line");
    assert.equal(hasMoveGuide(tool), true);
    tool.pointerUp(pointer(50, 30));

    assert.equal(highlightedPath(tool).length, 4, "both halves stay selected and highlighted");
    assert.deepEqual(events.at(-1), ["selection", 5], "both new ends join the selection (plus the shared corner)");
    assert.equal(handlesDrawn(tool), 2, "each half gets its own handle");

    assert.equal(undo(), true);
    tool.dataChanged();
    assert.deepEqual(geometry(), [[0, 0, 100, 0], [100, 0, 100, 100]], "one undo restores the original line");
});

test("split node snaps, clicking the handle changes nothing, and handles only show in Lines mode", () => {
    const { tool } = setup([
        { x1: 0, y1: 0, x2: 100, y2: 0 },
        { x1: 40, y1: 60, x2: 80, y2: 90 }
    ]);
    tool.setSelectionMode("lines");
    click(tool, 30, 0);
    click(tool, 50, 0);
    assert.deepEqual(geometry(), [[0, 0, 100, 0], [40, 60, 80, 90]]);
    assert.equal(highlightedPath(tool).length, 2, "clicking the handle keeps the selection");

    tool.setSelectionMode("nodes");
    assert.equal(handlesDrawn(tool), 0);
    tool.setSelectionMode("lines");
    assert.equal(handlesDrawn(tool), 1);

    // The test snap returns the cursor position; the engine's snap would pull to line ends like (40, 60).
    tool.pointerDown(pointer(50, 0));
    tool.pointerMove(pointer(40, 60));
    tool.pointerUp(pointer(40, 60));
    assert.deepEqual(geometry(), [[0, 0, 40, 60], [40, 60, 80, 90], [40, 60, 100, 0]]);
});

test("Shift on the handle selects instead of splitting", () => {
    const { tool } = setup([{ x1: 0, y1: 0, x2: 100, y2: 0 }]);
    tool.setSelectionMode("lines");
    click(tool, 30, 0);
    tool.pointerDown(pointer(50, 0, { shift: true }));
    tool.pointerMove(pointer(50, 20, { shift: true }));
    tool.pointerUp(pointer(50, 20, { shift: true }));
    assert.equal(lines.items.length, 1);
    assert.deepEqual(geometry(), [[0, 20, 100, 20]], "Shift-drag moves the selection as before");
});

test("turning split handles off hides them and lets the middle of a line move the selection", () => {
    const { tool } = setup([{ x1: 0, y1: 0, x2: 100, y2: 0 }]);
    tool.setSelectionMode("lines");
    click(tool, 30, 0);
    tool.setSplitHandles(false);
    assert.equal(handlesDrawn(tool), 0);
    tool.pointerDown(pointer(50, 0));
    tool.pointerMove(pointer(50, 20));
    tool.pointerUp(pointer(50, 20));
    assert.deepEqual(geometry(), [[0, 20, 100, 20]], "no split; the line moves");
    tool.setSplitHandles(true);
    assert.equal(handlesDrawn(tool), 1);
});

function setupStack() {
    const stacks = [];
    const result = setup([
        { x1: 0, y1: 0, x2: 100, y2: 0 },
        { x1: 0, y1: 0, x2: 0, y2: 100 },
        { x1: 0, y1: 0, x2: -50, y2: 0 },
        { x1: 200, y1: 200, x2: 300, y2: 200 }
    ], { stackChanged: info => stacks.push(info) });
    return { ...result, stacks };
}
const stackLabels = tool => draw(tool).calls.filter(([m, text]) => m === "fillText" && /^L\d$/.test(text)).map(([, text]) => text);

test("clicking a corner where lines meet lists each line end and labels the lines", () => {
    const { tool, stacks } = setupStack();
    click(tool, 1, 1);
    assert.deepEqual(stacks.at(-1), {
        x: "0 mm", y: "0 mm", shared: true,
        ends: [
            { label: "L1", selected: true, length: "100 mm", to: "100 mm, 0 mm" },
            { label: "L2", selected: true, length: "100 mm", to: "0 mm, 100 mm" },
            { label: "L3", selected: true, length: "50 mm", to: "−50 mm, 0 mm" }
        ]
    });
    assert.deepEqual(stackLabels(tool), ["L1", "L2", "L3"]);

    click(tool, 200, 200);
    assert.equal(stacks.at(-1), null, "a single line end has no Corner box");
    assert.deepEqual(stackLabels(tool), []);
});

test("unchecked line ends stay put when the corner is dragged", () => {
    const { tool, stacks, logs } = setupStack();
    click(tool, 0, 0);
    assert.equal(tool.toggleStackEnd(1), true);
    assert.equal(logs.at(-1).text, "L2 deselected");
    assert.deepEqual(stacks.at(-1).ends.map(e => e.selected), [true, false, true]);

    // Grabbing the corner again keeps the picked ends instead of reselecting all of them.
    tool.pointerDown(pointer(0, 0));
    tool.pointerMove(pointer(10, -20));
    tool.pointerUp(pointer(10, -20));
    assert.deepEqual(lines.items.map(l => [l.x1, l.y1, l.x2, l.y2]), [
        [10, -20, 100, 0], [0, 0, 0, 100], [10, -20, -50, 0], [200, 200, 300, 200]
    ]);
    assert.equal(stacks.at(-1), null, "the corner came apart, so the box closes");
});

test("all ends unchecked then rechecked, Esc and Done close the box, Lines mode has none", () => {
    const { tool, stacks } = setupStack();
    click(tool, 0, 0);
    for (const i of [0, 1, 2]) tool.toggleStackEnd(i);
    assert.deepEqual(stacks.at(-1).ends.map(e => e.selected), [false, false, false]);
    tool.toggleStackEnd(2);
    assert.deepEqual(stacks.at(-1).ends.map(e => e.selected), [false, false, true]);

    assert.equal(tool.cancel(), true);
    assert.equal(stacks.at(-1), null);
    assert.equal(tool.cancel(), false);

    click(tool, 0, 0);
    assert.equal(stacks.at(-1).ends.length, 3, "clicking the corner reopens the box");
    assert.equal(tool.closeStack(), true);
    assert.equal(stacks.at(-1), null);

    click(tool, 0, 0);
    tool.setSelectionMode("lines");
    assert.equal(stacks.at(-1), null);
    click(tool, 50, 0);
    assert.equal(stacks.at(-1), null);
});

function setupMixed() {
    const stacks = [], measurements = [], counts = [];
    bucket(MEASURES).items = [{
        id: 100,
        points: [
            { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 },
            { x: 50, y: 50, enabled: false }
        ]
    }];
    const { tool } = setup([{ x1: 0, y1: 0, x2: 100, y2: 0 }], {
        selectionGeometries: [lineGeometry, measurementGeometry],
        stackChanged: info => stacks.push(info),
        measurementSelectionChanged: id => measurements.push(id),
        selectionChanged: count => counts.push(count)
    });
    return { tool, stacks, measurements, counts, area: bucket(MEASURES).items[0] };
}

test("shared corners include blue area choices and unchecked area points stay put", () => {
    const { tool, stacks, measurements, area } = setupMixed();
    click(tool, 0, 0);
    const box = stacks.at(-1);
    assert.equal(box.ends.length, 2);
    assert.equal(box.ends[0].area, undefined);
    assert.equal(box.ends[1].area, true);
    assert.equal(box.ends[1].label, "Area 100 · P1");
    assert.equal(measurements.at(-1), null, "a mixed selection does not show area-only information");
    assert.equal(tool.selectedMeasurementId(), null, "mixed selection has no deletion target");
    assert.ok(draw(tool).calls.some(([m, text]) => m === "fillText" && text === "Area 100 · P1"));
    tool.toggleStackEnd(1);
    tool.pointerDown(pointer(0, 0));
    tool.pointerMove(pointer(20, 30));
    tool.pointerUp(pointer(20, 30));
    assert.deepEqual([lines.items[0].x1, lines.items[0].y1], [20, 30]);
    assert.deepEqual([area.points[0].x, area.points[0].y], [0, 0]);
});

test("rectangle selects line ends and area points together; dragging and undo move both", () => {
    const { tool, stacks, counts, area } = setupMixed();
    tool.pointerDown(pointer(-20, -20));
    tool.pointerMove(pointer(120, 120));
    tool.pointerUp(pointer(120, 120));
    assert.equal(counts.at(-1), 5, "two line ends and three enabled measurement points");
    assert.equal(stacks.at(-1).shared, false);
    assert.equal(stacks.at(-1).ends.filter(e => e.area).length, 3);
    const before = structuredClone(area);
    tool.pointerDown(pointer(0, 0));
    tool.pointerMove(pointer(20, 30));
    tool.pointerUp(pointer(20, 30));
    assert.deepEqual(geometry(), [[20, 30, 120, 30]]);
    assert.deepEqual(area.points.map(p => [p.x, p.y]), [[20, 30], [120, 30], [120, 130], [50, 50]]);
    assert.equal(undo(), true);
    tool.dataChanged();
    assert.deepEqual(bucket(MEASURES).items[0], before);
    assert.deepEqual(geometry(), [[0, 0, 100, 0]]);
});

test("blue area-only points select and move without activating the editor", () => {
    const { tool, measurements, counts, area } = setupMixed();
    click(tool, 100, 100);
    assert.equal(counts.at(-1), 1);
    assert.equal(measurements.at(-1), 100, "area-only information is available");
    assert.equal(tool.selectedMeasurementId(), 100, "only this saved measurement is the deletion target");
    tool.pointerDown(pointer(100, 100));
    tool.pointerMove(pointer(120, 100));
    tool.pointerUp(pointer(120, 100));
    assert.deepEqual([area.points[2].x, area.points[2].y], [120, 100]);
    assert.deepEqual(geometry(), [[0, 0, 100, 0]]);
    click(tool, 0, 0, { shift: true });
    assert.equal(measurements.at(-1), null, "adding a drawing endpoint hides area-only information");
    assert.equal(tool.selectedMeasurementId(), null);
    assert.equal(tool.canOpenMeasurement(), true);
});

test("guided Move previews and moves line and area points with the same offset", () => {
    const { tool, area } = setupMixed();
    tool.pointerDown(pointer(-20, -20));
    tool.pointerMove(pointer(120, 120));
    tool.pointerUp(pointer(120, 120));
    tool.startMove();
    assert.equal(tool.canOpenMeasurement(), false);
    click(tool, 0, 0);
    tool.confirmMoveBase();
    tool.pointerMove(pointer(20, 30));
    assert.ok(draw(tool).strokes.some(s => s.path.length >= 5), "preview contains the measurement polygon");
    click(tool, 20, 30);
    assert.deepEqual(geometry(), [[20, 30, 120, 30]]);
    assert.deepEqual(area.points.slice(0, 3).map(p => [p.x, p.y]), [[20, 30], [120, 30], [120, 130]]);
});

test("Lines mode includes shared area points but does not mistake measurements for drawing lines", () => {
    const { tool, area, counts } = setupMixed();
    tool.setSelectionMode("lines");
    click(tool, 30, 0);
    assert.equal(counts.at(-1), 4, "both line ends and the shared area points");
    assert.equal(handlesDrawn(tool), 1, "only the drawing line has a split handle");
    click(tool, 100, 100);
    assert.equal(counts.at(-1), 1, "an isolated blue point is selectable in Lines mode");
    assert.equal(handlesDrawn(tool), 0);
    assert.doesNotThrow(() => draw(tool));
    tool.pointerDown(pointer(100, 100));
    tool.pointerMove(pointer(110, 120));
    tool.pointerUp(pointer(110, 120));
    assert.deepEqual([area.points[2].x, area.points[2].y], [110, 120]);
});

test("Remove lines deletes only lines with both ends selected, reports the count and undoes in one step", () => {
    const counts = [];
    const { tool } = setup([
        { x1: 0, y1: 0, x2: 100, y2: 0 },
        { x1: 100, y1: 0, x2: 100, y2: 100 },
        { x1: 300, y1: 300, x2: 400, y2: 300 }
    ], { drawingItemSelectionChanged: n => counts.push(n) });
    assert.equal(tool.removeSelectedItems(), 0, "nothing selected");

    tool.setSelectionMode("lines");
    tool.pointerDown(pointer(50, 0));
    tool.pointerUp(pointer(50, 0));
    assert.deepEqual(counts, [1]);
    // The shared corner (100, 0) is selected, but the second line's other end is not.
    assert.equal(tool.removeSelectedItems(), 1);
    assert.deepEqual(lines.items.map(l => l.id), [2, 3]);
    assert.deepEqual(counts, [1, 0]);

    assert.equal(undo(), true);
    assert.deepEqual(lines.items.map(l => l.id), [1, 2, 3]);
});

test("in Nodes mode Delete removes every line touching a selected node", () => {
    const counts = [];
    const { tool } = setup([
        { x1: 0, y1: 0, x2: 100, y2: 0 },
        { x1: 100, y1: 0, x2: 100, y2: 100 },
        { x1: 300, y1: 300, x2: 400, y2: 300 }
    ], { drawingItemSelectionChanged: n => counts.push(n) });
    tool.pointerDown(pointer(100, 0)); // shared corner of lines 1 and 2
    tool.pointerUp(pointer(100, 0));
    assert.deepEqual(counts, [2]);
    tool.setSelectionMode("lines");
    assert.deepEqual(counts, [2, 0], "no line has both ends selected");
    tool.setSelectionMode("nodes");
    assert.equal(tool.removeSelectedItems(), 2);
    assert.deepEqual(lines.items.map(l => l.id), [3]);
});

test("Selections lists each selected item with a type label, draws the labels and deselects entries", () => {
    const lists = [];
    const { tool } = setup([
        { x1: 0, y1: 0, x2: 10, y2: 0 },
        { x1: 100, y1: 100, x2: 110, y2: 100 },
        { x1: 300, y1: 300, x2: 310, y2: 300 }
    ], { selectionListChanged: info => lists.push(info) });
    tool.setSelectionMode("lines");
    tool.pointerDown(pointer(-20, -20));
    tool.pointerMove(pointer(200, 200));
    tool.pointerUp(pointer(200, 200));

    assert.equal(tool.openSelectionList(), true);
    assert.deepEqual(lists.at(-1).entries, [
        { label: "L1", kind: "Line", detail: "10 mm", selected: true },
        { label: "L2", kind: "Line", detail: "10 mm", selected: true }
    ]);
    const labels = () => draw(tool).calls.filter(c => c[0] === "fillText").map(c => c[1]);
    assert.deepEqual(labels(), ["L1", "L2"]);

    assert.equal(tool.toggleSelectionEntry(0), true);
    assert.deepEqual(lists.at(-1).entries.map(e => [e.label, e.selected]), [["L1", false], ["L2", true]]);
    assert.deepEqual(highlightedPath(tool), [["moveTo", 100, 100], ["lineTo", 110, 100]], "only L2 stays selected");

    tool.toggleSelectionEntry(1);
    assert.deepEqual(lists.at(-1).entries.map(e => e.selected), [false, false], "unchecking all keeps the list open");
    tool.toggleSelectionEntry(0);
    assert.deepEqual(lists.at(-1).entries.map(e => e.selected), [true, false], "re-checking restores the item");

    tool.pointerDown(pointer(305, 300, { shift: true }));
    tool.pointerUp(pointer(305, 300, { shift: true }));
    assert.deepEqual(lists.at(-1).entries.map(e => e.label), ["L1", "L2", "L3"], "new selections get the next label");

    assert.equal(tool.cancel(), true, "Esc closes the list");
    assert.equal(lists.at(-1), null);
    assert.deepEqual(labels(), []);
    assert.equal(tool.openSelectionList(), true);
    tool.pointerDown(pointer(700, 700));
    tool.pointerUp(pointer(700, 700));
    assert.equal(lists.at(-1), null, "clearing the selection on the board closes the list");
});

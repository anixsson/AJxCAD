import test from "node:test";
import assert from "node:assert/strict";
import { bucket, clearAll, undo } from "../wwwroot/cad/store.js";
import { normalizeLayers, activeLayerId, addLayer, updateLayer } from "../wwwroot/cad/layers.js";
import { addShape, createCircleTool, createRectangleTool, shapeGeometry, SHAPES } from "../wwwroot/cad/shapes.js";
import { addText, createTextTool, textGeometry, TEXTS } from "../wwwroot/cad/text.js";
import { pagePdf } from "../wwwroot/cad/pdf.js";
import { createSelectTool } from "../wwwroot/cad/tools/select.js";

function reset() {
    clearAll();
    normalizeLayers();
}

const env = extra => ({
    snap: (x, y) => ({ x, y, kind: "grid" }),
    gridSnap: (x, y) => {
        const snap = value => {
            const result = Math.round(value / 10) * 10;
            return Object.is(result, -0) ? 0 : result;
        };
        return { x: snap(x), y: snap(y), kind: "grid" };
    },
    scale: () => 1,
    formatLength: mm => `${+mm.toFixed(3)} mm`,
    toScreen: (x, y) => ({ x, y }),
    redraw() {},
    log() {},
    ...extra
});
const click = (tool, x, y) => tool.pointerDown({ sx: x, sy: y, detail: 1 });

test("rectangle information follows the cursor and holds edited dimensions through placement", () => {
    reset();
    const changes = [];
    const tool = createRectangleTool(env({ shapeChanged: info => changes.push(info) }));
    click(tool, 100, 100);
    assert.deepEqual(changes.at(-1), { type: "rectangle", directionSet: false, width: 0, height: 0, radius: 0,
        widthFixed: false, heightFixed: false, radiusFixed: false });
    tool.pointerMove({ sx: 60, sy: 40 });
    assert.equal(changes.at(-1).width, 40);
    assert.equal(changes.at(-1).height, 60);
    tool.pointerLeave();
    tool.setDimension("width", 12.345);
    assert.ok(Math.abs(changes.at(-1).width - 12.345) < 1e-10);
    assert.equal(changes.at(-1).widthFixed, true);
    tool.pointerMove({ sx: 10, sy: 30 });
    assert.equal(changes.at(-1).height, 70);
    tool.setDimension("height", 25.4);
    click(tool, 20, 10);
    assert.equal(bucket(SHAPES).items.length, 0, "second click only sets direction");
    assert.equal(changes.at(-1).directionSet, true);
    tool.pointerMove({ sx: 200, sy: 200 });
    click(tool, 200, 200);
    tool.pointerLeave();
    tool.setDimension("width", 12.345);
    assert.equal(tool.save(), true);
    const shape = bucket(SHAPES).items[0];
    assert.ok(Math.abs(shape.x2 - 87.655) < 1e-10);
    assert.equal(shape.y2, 74.6);
    assert.equal(changes.at(-1), null);
    assert.equal(undo(), true);
    assert.equal(bucket(SHAPES).items.length, 0);
});

test("circle exact radius preserves direction and supports placement from the information box", () => {
    reset();
    const changes = [];
    const tool = createCircleTool(env({ shapeChanged: info => changes.push(info) }));
    click(tool, 0, 0);
    tool.pointerMove({ sx: -30, sy: 40 });
    tool.setDimension("radius", 12.7);
    assert.equal(changes.at(-1).radiusFixed, true);
    assert.ok(Math.abs(changes.at(-1).radius - 12.7) < 1e-10);
    click(tool, -30, 40);
    tool.pointerMove({ sx: 100, sy: 0 });
    tool.pointerLeave();
    assert.equal(tool.save(), true);
    const circle = bucket(SHAPES).items[0];
    assert.ok(Math.abs(circle.x2 + 7.62) < 1e-10);
    assert.ok(Math.abs(circle.y2 - 10.16) < 1e-10);
    click(tool, 0, 0);
    tool.setDimension("radius", 4.25);
    click(tool, 10, 0);
    const arcs = [];
    const g = new Proxy({ arc: (...args) => arcs.push(args) },
        { get: (target, key) => target[key] ?? (() => {}) });
    tool.draw(g, { dpr: 1, toScreen: (x, y) => ({ x, y }) });
    assert.equal(arcs[0][2], 4.25, "typed radius previews in the locked direction");
    assert.equal(tool.save(), true);
    assert.equal(bucket(SHAPES).items[1].x2, 4.25);
});

test("shape information releases exact values and resets on cancel, data change and tool switch", () => {
    for (const create of [createCircleTool, createRectangleTool]) {
        const changes = [];
        const tool = create(env({ shapeChanged: info => changes.push(info) }));
        for (const finish of ["cancel", "dataChanged", "deactivate"]) {
            click(tool, 0, 0);
            tool.pointerMove({ sx: 30, sy: 40 });
            const field = tool.id === "circle" ? "radius" : "width";
            tool.setDimension(field, 2.5);
            tool.useCursor();
            assert.equal(changes.at(-1)[field], tool.id === "circle" ? 50 : 30);
            assert.equal(changes.at(-1)[`${field}Fixed`], false);
            tool.setDimension(field, 2.5);
            tool[finish]();
            assert.equal(changes.at(-1), null);
            click(tool, 0, 0);
            assert.equal(changes.at(-1)[`${field}Fixed`], false);
            tool.cancel();
        }
    }
});

test("shape dimension validation rejects invalid input and degenerate placement without saving", () => {
    reset();
    const errors = [];
    const tool = createRectangleTool(env({ log: (kind, text) => errors.push({ kind, text }) }));
    assert.throws(() => tool.setDimension("width", 10), /first shape point/);
    click(tool, 0, 0);
    for (const value of [0, -1, NaN, Infinity, "10"]) {
        assert.throws(() => tool.setDimension("width", value), /positive, finite/);
    }
    assert.throws(() => tool.setDimension("radius", 10), /Unknown rectangle dimension/);
    tool.setDimension("width", 10);
    assert.equal(tool.save(), false, "placement requires a second click");
    click(tool, 10, 0);
    assert.equal(tool.save(), false);
    assert.equal(errors.at(-1).kind, "error");
    assert.equal(bucket(SHAPES).items.length, 0);
    tool.setDimension("height", 20);
    assert.equal(tool.save(), true);
    assert.equal(bucket(SHAPES).items.length, 1);
});

test("Place resets both shape tools for the next object and Reset direction unlocks the preview", () => {
    for (const create of [createCircleTool, createRectangleTool]) {
        reset();
        const changes = [];
        const tool = create(env({ shapeChanged: info => changes.push(info) }));
        for (let index = 0; index < 2; index++) {
            click(tool, 0, 0);
            assert.equal(changes.at(-1).directionSet, false);
            click(tool, -30, -40);
            assert.equal(changes.at(-1).directionSet, true);
            tool.useCursor();
            assert.equal(changes.at(-1).directionSet, false);
            tool.pointerMove({ sx: 30, sy: 40 });
            click(tool, 30, 40);
            if (tool.id === "circle") tool.setDimension("radius", 25);
            else {
                tool.setDimension("width", 12);
                tool.setDimension("height", 24);
            }
            assert.equal(tool.save(), true);
            assert.equal(changes.at(-1), null);
            assert.equal(bucket(SHAPES).items.length, index + 1);
        }
    }
});

test("saved shapes reopen for dimension editing, preserve their anchor and support cancel and undo", () => {
    for (const [create, type] of [[createCircleTool, "circle"], [createRectangleTool, "rectangle"]]) {
        reset();
        const item = addShape(type, { x: 100, y: 200 }, { x: 70, y: 160 });
        const original = { ...item };
        const changes = [];
        const tool = create(env({ shapeChanged: info => changes.push(info) }));
        tool.inspect(item.id);
        assert.equal(changes.at(-1).id, item.id);
        assert.equal(changes.at(-1).directionSet, true);
        const field = type === "circle" ? "radius" : "width";
        tool.setDimension(field, 25);
        tool.inspect(item.id);
        assert.equal(changes.at(-1)[field], 25, "unchanged selection preserves pending edits");
        assert.deepEqual(item, original, "editing previews without changing saved geometry");
        tool.cancel();
        assert.deepEqual(item, original);
        tool.inspect(item.id);
        tool.setDimension(field, 25);
        assert.equal(tool.save(), true);
        assert.equal(bucket(SHAPES).items.length, 1, "saving edits does not create another shape");
        assert.equal(item.x1, 100);
        assert.equal(item.y1, 200);
        if (type === "circle") {
            assert.ok(Math.abs(Math.hypot(item.x2 - item.x1, item.y2 - item.y1) - 25) < 1e-10);
        } else {
            assert.equal(item.x2, 75);
            assert.equal(item.y2, 160);
        }
        assert.equal(undo(), true);
        assert.deepEqual(bucket(SHAPES).items[0], original);
        tool.inspect(original.id);
        const restored = bucket(SHAPES).items[0];
        restored.x2 -= 10;
        tool.inspect(restored.id);
        assert.equal(changes.at(-1).width, 40, "handle edits refresh inspected dimensions");
    }
});

test("shape placement shows snapped radius or positive width and height in project units", () => {
    reset();
    for (const [create, expected] of [
        [createCircleTool, [["Radius 50 mm", 40, -80]]],
        [createRectangleTool, [["Width 30 mm", -20, -96], ["Height 40 mm", 56, 0]]]
    ]) {
        const tool = create(env());
        const labels = [];
        const g = new Proxy({
            fillText: (...args) => labels.push(args)
        }, { get: (target, key) => target[key] ?? (() => {}) });
        const view = { dpr: 2, paper: false, fx: true, toScreen: (x, y) => ({ x: 2 * x, y: -2 * y }) };
        tool.pointerMove({ sx: 10, sy: 20 });
        tool.draw(g, view);
        assert.deepEqual(labels, [], "no size before the first click");
        click(tool, 13, 17); // grid point (10, 20)
        tool.draw(g, view);
        assert.deepEqual(labels, [], "no size before moving from the first point");
        tool.pointerMove({ sx: -17, sy: -17 }); // grid point (-20, -20)
        tool.draw(g, view);
        assert.deepEqual(labels.splice(0), expected, "labels use circle centre or rectangle edge midpoints");
        assert.equal(g.font, "24px system-ui, -apple-system, sans-serif");
        assert.equal(g.fillStyle, "#fff");
        assert.equal(g.shadowBlur, 8);
        tool.draw(g, { ...view, paper: true });
        assert.deepEqual(labels.splice(0), expected);
        assert.equal(g.fillStyle, "#000");
        assert.equal(g.shadowBlur, 0);
        tool.pointerLeave();
        tool.draw(g, view);
        assert.deepEqual(labels, [], "leaving the canvas hides feedback");
        tool.pointerMove({ sx: 40, sy: 60 });
        click(tool, 40, 60);
        tool.save();
        tool.draw(g, view);
        assert.deepEqual(labels, [], "placing the shape clears feedback");
    }
});

test("shape feedback updates with units and clears when cancelled or deactivated", () => {
    for (const create of [createCircleTool, createRectangleTool]) {
        let imperial = false;
        const tool = create(env({ formatLength: mm => imperial ? `${mm / 25.4} in` : `${mm} mm` }));
        const labels = [];
        const g = new Proxy({ fillText: text => labels.push(text) },
            { get: (target, key) => target[key] ?? (() => {}) });
        const view = { dpr: 1, paper: false, fx: false, toScreen: (x, y) => ({ x, y }) };
        click(tool, 0, 0);
        tool.pointerMove({ sx: 30, sy: 40 });
        tool.draw(g, view);
        assert.ok(labels.length > 0);
        for (const label of labels.splice(0)) assert.match(label, /mm/);
        imperial = true;
        tool.draw(g, view);
        assert.ok(labels.length > 0);
        for (const label of labels.splice(0)) assert.match(label, /in/);
        tool.cancel();
        tool.draw(g, view);
        assert.deepEqual(labels, []);
        click(tool, 0, 0);
        tool.pointerMove({ sx: 30, sy: 40 });
        tool.deactivate();
        tool.draw(g, view);
        assert.deepEqual(labels, []);
    }
});

test("circle and rectangle tools confirm two-point outline geometry with Place and support undo", () => {
    reset();
    const circle = createCircleTool(env());
    assert.equal(circle.hotkey, "o");
    click(circle, 13, 17);
    click(circle, 26, 37);
    assert.equal(bucket(SHAPES).items.length, 0);
    circle.save();
    const { id: circleId, ...circleShape } = bucket(SHAPES).items[0];
    assert.ok(circleId > 0);
    assert.deepEqual(circleShape, { type: "circle", x1: 10, y1: 20, x2: 30, y2: 40, layerId: activeLayerId() });
    const rectangle = createRectangleTool(env());
    click(rectangle, -5, -2);
    click(rectangle, 20, 25);
    rectangle.save();
    assert.equal(bucket(SHAPES).items[1].type, "rectangle");
    assert.deepEqual(shapeGeometry.points(bucket(SHAPES).items[1]), [
        { key: "tl", x: 0, y: 30 }, { key: "tr", x: 20, y: 30 },
        { key: "br", x: 20, y: 0 }, { key: "bl", x: 0, y: 0 }
    ]);
    shapeGeometry.setPoint(bucket(SHAPES).items[1], "br", 30, -12);
    assert.deepEqual([bucket(SHAPES).items[1].x2, bucket(SHAPES).items[1].y1], [30, -12]);
    undo();
    assert.equal(bucket(SHAPES).items.length, 1);
});

test("text tool waits for content, saves an anchored item, and cancels pending placement", () => {
    reset();
    const changes = [];
    const tool = createTextTool(env({ textChanged: value => changes.push(value) }));
    assert.equal(tool.hotkey, "t");
    click(tool, 33, 44);
    assert.deepEqual(changes.at(-1), { mode: "place", x: 30, y: 40, text: "", fontSize: 4.5,
        fontFamily: "sans-serif", bold: false, italic: false, underline: false });
    assert.equal(bucket(TEXTS).items.length, 0);
    tool.setDraft({ mode: "place", text: "  Workshop  ", x: 30, y: 40, fontSize: 8,
        fontFamily: "serif", bold: true, italic: true, underline: true });
    tool.save();
    const { id: textId, ...savedText } = bucket(TEXTS).items[0];
    assert.ok(textId > 0);
    assert.deepEqual(savedText, { text: "Workshop", x: 30, y: 40, fontSize: 8,
        fontFamily: "serif", bold: true, italic: true, underline: true, layerId: activeLayerId() });
    assert.equal(changes.at(-1).mode, "edit", "new text opens its information editor after placement");
    assert.equal(tool.cancel(), true, "cancel closes the information editor");
    assert.equal(changes.at(-1), null);
    tool.open(textId);
    tool.setDraft({ mode: "edit", id: textId, text: "Workshop 2", x: 30, y: 40, fontSize: 12,
        fontFamily: "monospace", bold: false, italic: true, underline: false });
    tool.save();
    assert.equal(bucket(TEXTS).items[0].text, "Workshop 2");
    assert.equal(bucket(TEXTS).items[0].fontSize, 12);
    assert.equal(bucket(TEXTS).items[0].fontFamily, "monospace");
    assert.equal(undo(), true);
    assert.equal(bucket(TEXTS).items[0].text, "Workshop");
    click(tool, 50, 60);
    assert.equal(tool.cancel(), true);
    assert.equal(tool.cancel(), false);
    assert.equal(bucket(TEXTS).items.length, 1);
    assert.throws(() => addText("  ", 0, 0), /cannot be empty/);
    assert.throws(() => addText("x".repeat(241), 0, 0), /240 characters/);
});

test("text, circle, and rectangle show a grid snap indicator before their first placement", () => {
    const view = { dpr: 1, paper: false, toScreen: (x, y) => ({ x, y }) };
    for (const create of [createTextTool, createCircleTool, createRectangleTool]) {
        const indicators = [];
        const tool = create(env({
            textChanged() {},
            redraw() {}
        }));
        tool.pointerMove({ sx: 13, sy: 17 });
        tool.draw({ strokeRect: (...args) => indicators.push(args) }, view);
        assert.deepEqual(indicators, [[6, 16, 8, 8]]);
    }
});

test("text shows a live preview at its font size while it is being placed", () => {
    reset();
    const tool = createTextTool(env({ textChanged() {} }));
    click(tool, 30, 40);
    tool.setDraft({ mode: "place", text: "Live", x: 30, y: 40, fontSize: 20,
        fontFamily: "serif", bold: true, italic: false, underline: false });
    const calls = [];
    const context = new Proxy({
        fillText: (...args) => calls.push(args), measureText: text => ({ width: text.length * 7 }),
        set font(value) { calls.push(["font", value]); }
    }, { get: (target, key) => target[key] ?? (() => {}) });
    const view = { dpr: 1, paper: false, fx: false, scale: 2, toScreen: (x, y) => ({ x, y }) };
    textGeometry.draw(context, [], view);
    assert.deepEqual(calls.find(c => c[0] === "Live"), ["Live", 30, 40]);
    assert.ok(calls.some(c => c[0] === "font" && c[1].includes("bold 40px serif")), "preview scales with zoom");
    tool.cancel();
    calls.length = 0;
    textGeometry.draw(context, [], view);
    assert.equal(calls.length, 0, "cancelling removes the preview");
});

test("shape and text geometry draw and hit-test as selectable items", () => {
    reset();
    const rectangle = { type: "rectangle", x1: 0, y1: 0, x2: 100, y2: 80 };
    const circle = { type: "circle", x1: 200, y1: 200, x2: 250, y2: 200 };
    const text = addText("Label", 300, 300);
    const view = { dpr: 1, paper: false, fx: false, scale: 1, toScreen: (x, y) => ({ x, y }) };
    const calls = [];
    const context = new Proxy({
        arc: (...args) => calls.push(["arc", ...args]), rect: (...args) => calls.push(["rect", ...args]),
        fillText: (...args) => calls.push(["text", ...args]), measureText: text => ({ width: text.length * 7 })
    },
        { get: (target, key) => target[key] ?? (() => {}) });
    shapeGeometry.draw(context, [rectangle, circle], view);
    textGeometry.draw(context, [text], view);
    assert.ok(calls.some(([name]) => name === "rect"));
    assert.ok(calls.some(([name]) => name === "arc"));
    assert.deepEqual(calls.find(([name]) => name === "text"), ["text", "Label", 300, 300]);
    const screen = { toScreen: (x, y) => ({ x, y }), scale: () => 1 };
    assert.equal(shapeGeometry.hitTest(rectangle, 50, 40, screen), 0);
    assert.equal(shapeGeometry.hitTest(circle, 250, 200, screen), 0);
    assert.equal(textGeometry.hitTest(text, 305, 300, screen), 0);
});

test("PDF and canvas text retain the same size relative to drawing geometry", () => {
    reset();
    const item = addText("Label", 0, 0, { fontSize: 20 });
    for (const pageScale of [1, 10, 50]) {
        const pdf = pagePdf({ paper: "A4", scale: pageScale, x: 0, y: 0, textSize: 400 },
            [], [], undefined, [], [item]);
        const pdfSize = Number(pdf.match(/\/F1 ([\d.]+) Tf/)[1]);
        for (const scale of [0.5, 2, 10]) {
            for (const dpr of [1, 2]) {
                const context = { fillText() {} };
                textGeometry.draw(context, [item], {
                    dpr, scale, paper: true, fx: false, printPx: 8,
                    toScreen: (x, y) => ({ x: x * scale, y: -y * scale })
                });
                const canvasSize = parseFloat(context.font);
                assert.equal(context.fillStyle, "#000", "drawing text uses black ink in print preview");
                const worldSize = canvasSize / (scale * dpr);
                assert.ok(Math.abs(pdfSize * pageScale * 25.4 / 72 - worldSize) < 0.01,
                    "printed size matches canvas size in world millimetres");
            }
        }
    }
});

test("circle marquee selection selects both handles and the rectangle exposes four draggable corners", () => {
    reset();
    const circle = { type: "circle", x1: 100, y1: 100, x2: 150, y2: 100 };
    assert.deepEqual(shapeGeometry.selectRect(circle, { left: 40, right: 160, top: 40, bottom: 160 },
        { toScreen: (x, y) => ({ x, y }) }), ["center", "radius"]);
    assert.equal(shapeGeometry.selectRect(circle, { left: 40, right: 140, top: 40, bottom: 160 },
        { toScreen: (x, y) => ({ x, y }) }), null);
    const rectangle = { type: "rectangle", x1: 0, y1: 0, x2: 100, y2: 100 };
    shapeGeometry.setPoint(rectangle, "tl", -20, 120);
    assert.deepEqual(shapeGeometry.points(rectangle), [
        { key: "tl", x: -20, y: 120 }, { key: "tr", x: 100, y: 120 },
        { key: "br", x: 100, y: 0 }, { key: "bl", x: -20, y: 0 }
    ]);
    shapeGeometry.moveItem(rectangle, 15, -5);
    assert.deepEqual([rectangle.x1, rectangle.y1, rectangle.x2, rectangle.y2], [-5, -5, 115, 115]);
});

test("editing shapes shows live dimensions alongside offset and clears them on release", () => {
    for (const [type, expected] of [
        ["circle", ["Radius 50 mm"]],
        ["rectangle", ["Width 30 mm", "Height 40 mm"]]
    ]) {
        reset();
        addShape(type, { x: 0, y: 0 }, { x: 100, y: 80 });
        const tool = createSelectTool(env({
            geometries: [shapeGeometry], selectionGeometries: [shapeGeometry],
            toWorld: (x, y) => ({ x, y }), capture() {}
        }));
        const labels = [];
        const g = new Proxy({ fillText: text => labels.push(text) },
            { get: (target, key) => target[key] ?? (() => {}) });
        const view = { dpr: 1, paper: false, fx: false, width: 1000, height: 1000,
            toScreen: (x, y) => ({ x, y }) };
        tool.pointerDown({ sx: 100, sy: 80, pointerId: 1 });
        tool.pointerMove({ sx: 30, sy: 40 });
        tool.draw(g, view);
        for (const label of expected) assert.ok(labels.includes(label), labels.join("; "));
        assert.ok(labels.some(text => text.startsWith("Offset ")), "offset remains visible");
        labels.length = 0;
        tool.pointerUp({ sx: 30, sy: 40, pointerId: 1 });
        tool.draw(g, view);
        for (const label of expected) assert.ok(!labels.includes(label), "dimension feedback ends on release");
    }
});

test("Select can move and delete shapes and text through their geometry anchors", () => {
    reset();
    addShape("rectangle", { x: 0, y: 0 }, { x: 100, y: 80 });
    const tool = createSelectTool({
        geometries: [shapeGeometry, textGeometry],
        selectionGeometries: [shapeGeometry, textGeometry],
        toWorld: (x, y) => ({ x, y }),
        toScreen: (x, y) => ({ x, y }),
        snap: (x, y) => ({ x, y, kind: "grid" }),
        capture() {},
        redraw() {},
        log() {},
        formatLength: value => `${value} mm`
    });
    tool.pointerDown({ sx: 50, sy: 40, pointerId: 1 });
    tool.pointerUp({ sx: 50, sy: 40, pointerId: 1 });
    assert.equal(tool.selectedLayerItems().length, 1);
    assert.equal(tool.removeSelectedItems(), 1);
    assert.equal(bucket(SHAPES).items.length, 0);
    undo();
    assert.equal(bucket(SHAPES).items.length, 1);

    reset();
    addText("Label", 300, 300);
    const textTool = createSelectTool({
        geometries: [shapeGeometry, textGeometry],
        selectionGeometries: [shapeGeometry, textGeometry],
        toWorld: (x, y) => ({ x, y }),
        toScreen: (x, y) => ({ x, y }),
        snap: (x, y) => ({ x, y, kind: "grid" }),
        capture() {},
        redraw() {},
        log() {},
        formatLength: value => `${value} mm`
    });
    textTool.pointerDown({ sx: 305, sy: 300, pointerId: 1 });
    textTool.pointerUp({ sx: 305, sy: 300, pointerId: 1 });
    assert.equal(textTool.selectedLayerItems().length, 1);
    assert.equal(textTool.removeSelectedItems(), 1);
    assert.equal(bucket(TEXTS).items.length, 0);
});

test("PDF output includes printable shapes and text and omits hidden layers", () => {
    reset();
    const hiddenLayer = activeLayerId();
    addLayer();
    updateLayer(hiddenLayer, { visible: false });
    const page = { paper: "A4", landscape: 0, scale: 10, x: 0, y: 0 };
    const shapes = [
        { type: "rectangle", x1: 0, y1: 0, x2: 100, y2: 50 },
        { type: "circle", x1: 100, y1: 100, x2: 150, y2: 100 },
        { type: "rectangle", x1: 0, y1: 0, x2: 10, y2: 10, layerId: hiddenLayer }
    ];
    const texts = [{ text: "Note", x: 10, y: 20, fontSize: 8, fontFamily: "serif", bold: true, italic: true, underline: true }];
    const pdf = pagePdf(page, [], [], undefined, shapes, texts);
    const body = pdf.slice(pdf.indexOf("stream\n") + 7, pdf.indexOf("\nendstream"));
    assert.ok(body.includes(" re\n"), "rectangle is a PDF path");
    assert.ok(body.includes(" c h"), "circle is a Bézier path");
    assert.ok(body.includes("(Note) Tj"), "text is printed");
    assert.ok(body.includes("/F8 "), "bold italic serif uses its PDF font");
    assert.ok(body.includes(" l S"), "underline is drawn");
    assert.equal((body.match(/ re\n/g) ?? []).length, 1, "the unknown hidden layer is not printed");
});

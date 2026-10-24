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
    toScreen: (x, y) => ({ x, y }),
    redraw() {},
    log() {},
    ...extra
});
const click = (tool, x, y) => tool.pointerDown({ sx: x, sy: y, detail: 1 });

test("circle and rectangle tools create their outline geometry from two points and support undo", () => {
    reset();
    const circle = createCircleTool(env());
    assert.equal(circle.hotkey, "o");
    click(circle, 13, 17);
    click(circle, 26, 37);
    const { id: circleId, ...circleShape } = bucket(SHAPES).items[0];
    assert.ok(circleId > 0);
    assert.deepEqual(circleShape, { type: "circle", x1: 10, y1: 20, x2: 30, y2: 40, layerId: activeLayerId() });
    const rectangle = createRectangleTool(env());
    click(rectangle, -5, -2);
    click(rectangle, 20, 25);
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

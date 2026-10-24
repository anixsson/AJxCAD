import test from "node:test";
import assert from "node:assert/strict";
import { belowDetailThreshold, detailSize, MIN_DETAIL_PX } from "../wwwroot/cad/optimizer.js";
import { bucket, clearAll, serialize } from "../wwwroot/cad/store.js";
import { activeLayerId, normalizeLayers, updateLayer } from "../wwwroot/cad/layers.js";
import { addLine } from "../wwwroot/cad/lines.js";
import { addShape } from "../wwwroot/cad/shapes.js";
import { addText } from "../wwwroot/cad/text.js";
import { addPoint } from "../wwwroot/cad/points.js";
import { addPage } from "../wwwroot/cad/pages.js";

test("detail culling uses a strict 3 CSS pixel threshold for each scalable tool", () => {
    assert.equal(MIN_DETAIL_PX, 3);
    const cases = [
        ["lines", { x1: 0, y1: 0, x2: 3, y2: 4 }, 5],
        ["shapes", { type: "rectangle", x1: 0, y1: 0, x2: 3, y2: 4 }, 5],
        ["shapes", { type: "circle", x1: 0, y1: 0, x2: 3, y2: 4 }, 10],
        ["texts", { fontSize: 5 }, 5],
        ["texts", {}, 4.5],
        ["measures", { points: [{ x: 0, y: 0 }, { x: 3, y: 4 }] }, 5]
    ];
    for (const [name, item, size] of cases) {
        assert.equal(detailSize(name, item), size);
        assert.equal(belowDetailThreshold(name, item, 2.99 / size), true);
        assert.equal(belowDetailThreshold(name, item, 3 / size), false, "exactly 3 px remains visible");
        assert.equal(belowDetailThreshold(name, item, 4 / size), false);
    }
    for (const name of ["points", "pages"])
        assert.equal(belowDetailThreshold(name, {}, 0.00001), false);
});

test("measurement extent ignores disabled points but includes offset dimension geometry", () => {
    const item = { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 10000, y: 0, enabled: false }] };
    assert.equal(belowDetailThreshold("measures", item, 1), true);
    assert.equal(belowDetailThreshold("measures", { ...item, dimension: { x: 0, y: 100 } }, 1), false);
    assert.equal(belowDetailThreshold("measures", { points: [] }, 1), true);
});

test("engine shares culling between drawing, picking and snapping, while preview and PDF bypass it", async () => {
    clearAll();
    normalizeLayers();
    const callbacks = [];
    const frames = new Map();
    let nextFrame = 0;
    globalThis.window = Object.assign(new EventTarget(), { devicePixelRatio: 2 });
    globalThis.document = Object.assign(new EventTarget(), {
        hasFocus: () => true, activeElement: { tagName: "BODY" },
        querySelector: () => null, querySelectorAll: () => []
    });
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
    globalThis.cancelAnimationFrame = id => frames.delete(id);
    const textDraws = [];
    const context = new Proxy({
        measureText: text => ({ width: text.length * 7 }),
        fillText: text => textDraws.push(text)
    }, { get: (target, key) => target[key] ?? (() => {}) });
    const workspace = Object.assign(new EventTarget(), {
        clientWidth: 1024, clientHeight: 768, style: {},
        classList: { toggle() {}, add() {}, remove() {} },
        setPointerCapture() {},
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
        focus() { document.activeElement = workspace; }
    });
    const flush = () => {
        for (let i = 0; frames.size && i < 10; i++) {
            const batch = [...frames.values()];
            frames.clear();
            for (const callback of batch) callback(performance.now() + 1000);
        }
        assert.equal(frames.size, 0, "rendering settles");
    };
    const pointer = (type, x, y) => workspace.dispatchEvent(Object.assign(new Event(type), {
        button: 0, clientX: x, clientY: y, detail: 1, pointerId: 1
    }));
    const click = (x, y) => {
        pointer("pointerdown", x, y);
        pointer("pointerup", x, y);
        flush();
    };
    const engine = await import("../wwwroot/cad/engine.js");
    engine.init(workspace, { getContext: () => context }, {
        invokeMethodAsync: (name, ...args) => { callbacks.push({ name, args }); return Promise.resolve(); }
    }, 1000, 1000);
    const optimizer = () => callbacks.findLast(c => c.name === "OnOptimizerChanged").args;
    const pointInfo = () => callbacks.findLast(c => c.name === "OnPointChanged").args[0];
    const selected = () => callbacks.findLast(c => c.name === "OnSelectionChanged")?.args[0] ?? 0;
    try {
        addLine(23, 17, 24, 17);
        addShape("circle", { x: 100, y: 0 }, { x: 100.5, y: 0 });
        addShape("rectangle", { x: 200, y: 0 }, { x: 201, y: 1 });
        addText("Tiny", 300, 0, { fontSize: 1 });
        const measure = { id: 9000, points: [{ x: 400, y: 0 }, { x: 401, y: 0 }], layerId: activeLayerId() };
        bucket("measures").items.push(measure);
        const point = addPoint(-100, 0);
        const page = addPage({ x: 0, y: 0, scale: 10, paper: "A4" });
        flush();
        assert.deepEqual(optimizer(), [true, 5]);
        assert.ok(!textDraws.includes("Tiny"), "tiny text is not rendered");
        const initial = serialize();
        engine.setOptimizerEnabled(false);
        flush();
        assert.deepEqual(optimizer(), [false, 5], "panel stays available when disabled");
        assert.ok(textDraws.includes("Tiny"));
        assert.equal(serialize(), initial, "view optimization never alters project data");
        engine.setTool("select");
        click(535, 367);
        assert.ok(selected() > 0);
        engine.setOptimizerEnabled(true);
        flush();
        assert.equal(selected(), 0, "hidden objects are deselected");
        click(535, 367);
        assert.equal(selected(), 0, "hidden geometry cannot be selected");
        click(412, 384);
        assert.equal(pointInfo().point.id, point.id, "fixed-screen-size points remain selectable");
        engine.setTool("point");
        click(535, 367);
        assert.notDeepEqual([pointInfo().point.x, pointInfo().point.y], [23, 17], "hidden node is not snapped to");
        engine.setOptimizerEnabled(false);
        flush();
        click(535, 367);
        assert.deepEqual([pointInfo().point.x, pointInfo().point.y], [23, 17], "disabling optimizer restores snapping");
        const fullPdf = engine.getPagePdf(page.id).pdf;
        engine.setOptimizerEnabled(true);
        flush();
        assert.equal(engine.getPagePdf(page.id).pdf, fullPdf, "printing and PDF never depend on optimizer state");
        assert.match(fullPdf, /\(Tiny\) Tj/);
        engine.setTool("page");
        engine.selectPage(page.id);
        engine.setPagePreview(true);
        textDraws.length = 0;
        flush();
        assert.deepEqual(optimizer(), [true, 0], "preview suppresses culling and its panel");
        assert.ok(textDraws.includes("Tiny"), "preview renders tiny objects");
        engine.setPagePreview(false);
        flush();
        assert.deepEqual(optimizer(), [true, 5]);
        engine.zoomBy(10);
        flush();
        assert.deepEqual(optimizer(), [true, 0], "zooming in restores small objects");
        engine.zoomBy(0.1);
        flush();
        assert.deepEqual(optimizer(), [true, 5]);
        updateLayer(point.layerId, { visible: false });
        engine.setOptimizerEnabled(false);
        flush();
        assert.deepEqual(optimizer(), [false, 0], "layer-hidden items are not counted as optimized away");
        assert.ok(!engine.getPagePdf(page.id).pdf.includes("(Tiny) Tj"), "layer rules still apply to PDF");
        assert.throws(() => engine.setOptimizerEnabled("false"), /checkbox/);
    } finally {
        engine.dispose();
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.ResizeObserver;
        delete globalThis.requestAnimationFrame;
        delete globalThis.cancelAnimationFrame;
    }
});

import test from "node:test";
import assert from "node:assert/strict";
import { bucket, clearAll } from "../wwwroot/cad/store.js";
import { normalizeLayers } from "../wwwroot/cad/layers.js";
import { POINTS } from "../wwwroot/cad/points.js";

test("snap box: grid snapping can be switched off for all tools and midpoint nodes snap lines and rectangles", async () => {
    clearAll(); normalizeLayers();
    globalThis.window = Object.assign(new EventTarget(), { devicePixelRatio: 1 });
    globalThis.document = Object.assign(new EventTarget(), {
        hasFocus: () => true, activeElement: { tagName: "BODY" },
        querySelector: () => null, querySelectorAll: () => []
    });
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
    const engine = await import("../wwwroot/cad/engine.js");
    const { addLine } = await import("../wwwroot/cad/lines.js");
    const { addShape, SHAPES } = await import("../wwwroot/cad/shapes.js");
    const workspace = Object.assign(new EventTarget(), {
        clientWidth: 1024, clientHeight: 768, style: {},
        classList: { toggle() {}, add() {}, remove() {} },
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
        focus() {}, setPointerCapture() {}
    });
    const pointer = (type, x, y) => workspace.dispatchEvent(Object.assign(new Event(type), {
        button: 0, clientX: x, clientY: y, detail: 1, pointerId: 1
    }));
    const click = (x, y) => { pointer("pointerdown", x, y); pointer("pointerup", x, y); };
    const last = () => { const p = bucket(POINTS).items.at(-1); return [p.x, p.y]; };
    const near = ([x, y], [ex, ey]) => assert.ok(Math.abs(x - ex) < 1e-6 && Math.abs(y - ey) < 1e-6, `${x},${y} ≠ ${ex},${ey}`);
    engine.init(workspace, { getContext: () => ({}) }, { invokeMethodAsync: () => Promise.resolve() }, 1000, 1000);
    try {
        engine.setTool("point");
        addLine(0, 200, 300, 200);
        addShape("rectangle", { x: -400, y: -100 }, { x: -200, y: -300 });

        click(665, 286);
        near(last(), [160, 100]); // defaults: grid on, midpoints off

        engine.setSnapOptions(false, false, false);
        click(615.5, 380.25);
        near(last(), [103.5, 3.75]);
        click(512, 184);
        near(last(), [0, 200], "line ends still snap with the grid off");

        engine.setSnapOptions(false, true, false);
        click(665, 186);
        near(last(), [150, 200]);
        click(215, 582);
        near(last(), [-300, -200]);
        click(213, 486);
        near(last(), [-300, -100]);
        click(310, 586);
        near(last(), [-200, -200]);
        assert.equal(bucket("lines").items.length, 1, "midpoint nodes are temporary, never stored");
        assert.deepEqual(Object.keys(bucket(SHAPES).items[0]).sort(), ["id", "layerId", "type", "x1", "x2", "y1", "y2"]);

        engine.setSnapOptions(true, true, false);
        click(665, 186);
        near(last(), [150, 200], "midpoint snap beats the grid");
        click(565, 286);
        near(last(), [60, 100], "grid is back on");
        assert.throws(() => engine.setSnapOptions(true, true, "yes"), /checkbox/);
    } finally {
        engine.dispose();
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.ResizeObserver;
        delete globalThis.requestAnimationFrame;
        delete globalThis.cancelAnimationFrame;
    }
});

test("snap box: resting on a node acquires reference lines that snap orthogonally until released", async t => {
    clearAll(); normalizeLayers();
    t.mock.timers.enable({ apis: ["setTimeout"] });
    globalThis.window = Object.assign(new EventTarget(), { devicePixelRatio: 1 });
    globalThis.document = Object.assign(new EventTarget(), {
        hasFocus: () => true, activeElement: { tagName: "BODY" },
        querySelector: () => null, querySelectorAll: () => []
    });
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
    const engine = await import("../wwwroot/cad/engine.js");
    const { addLine } = await import("../wwwroot/cad/lines.js");
    const logs = [];
    const workspace = Object.assign(new EventTarget(), {
        clientWidth: 1024, clientHeight: 768, style: {},
        classList: { toggle() {}, add() {}, remove() {} },
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
        focus() {}, setPointerCapture() {}
    });
    const pointer = (type, x, y) => workspace.dispatchEvent(Object.assign(new Event(type), {
        button: 0, clientX: x, clientY: y, detail: 1, pointerId: 1
    }));
    const click = (x, y) => { pointer("pointerdown", x, y); pointer("pointerup", x, y); };
    const rest = (x, y, ms = 1000) => { pointer("pointermove", x, y); t.mock.timers.tick(ms); };
    const last = () => { const p = bucket(POINTS).items.at(-1); return [p.x, p.y]; };
    engine.init(workspace, { getContext: () => ({}) }, {
        invokeMethodAsync: (name, kind, text) => { if (name === "OnLog") logs.push(text); return Promise.resolve(); }
    }, 1000, 1000);
    try {
        engine.setTool("point");
        addLine(103, 57, 300, 200);

        rest(615, 327);
        click(617, 500);
        assert.deepEqual(last(), [100, -120], "no reference while the option is off");

        engine.setSnapOptions(true, false, true);
        rest(615, 327, 999);
        click(618, 600);
        assert.deepEqual(last(), [100, -220], "not acquired before the hold time");
        t.mock.timers.tick(1);
        assert.ok(logs.includes("reference acquired at 103, 57"));
        click(617, 650);
        assert.deepEqual(last(), [103, -260], "vertical guide locks x, grid sets y");
        click(800, 329);
        assert.deepEqual(last(), [280, 57], "horizontal guide locks y, grid sets x");

        engine.setSnapOptions(false, false, true);
        click(840.5, 329);
        assert.deepEqual(last(), [328.5, 57], "with the grid off the free axis follows the cursor");
        engine.setSnapOptions(true, false, true);

        rest(812, 184);
        click(813, 329);
        assert.deepEqual(last(), [300, 57], "two guides cross");

        rest(615, 327);
        assert.ok(logs.includes("reference released at 103, 57"));
        click(619, 700);
        assert.deepEqual(last(), [100, -320]);
        click(813, 700);
        assert.deepEqual(last(), [300, -320], "the other reference stays");

        rest(615, 327);
        engine.setTool("select");
        engine.setTool("point");
        click(617, 740);
        assert.deepEqual(last(), [100, -360], "changing tool clears references");
        assert.equal(bucket("lines").items.length, 1);
    } finally {
        engine.dispose();
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.ResizeObserver;
        delete globalThis.requestAnimationFrame;
        delete globalThis.cancelAnimationFrame;
    }
});

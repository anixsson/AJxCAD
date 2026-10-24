import test from "node:test";
import assert from "node:assert/strict";

test("only Select opens saved measurement text; blue points select without opening the editor", async () => {
    let frame;
    const texts = [];
    const calls = [];
    globalThis.window = Object.assign(new EventTarget(), { devicePixelRatio: 1 });
    globalThis.document = Object.assign(new EventTarget(), {
        hasFocus: () => true,
        activeElement: { tagName: "BODY" },
        querySelector: () => null,
        querySelectorAll: () => []
    });
    globalThis.ResizeObserver = class {
        observe() {}
        disconnect() {}
    };
    globalThis.requestAnimationFrame = callback => { frame = callback; return 1; };
    globalThis.cancelAnimationFrame = () => {};
    const context = new Proxy({
        measureText: text => ({ width: text.length * 7 }),
        fillText: (text, x, y) => texts.push({ text, x, y })
    }, { get: (target, key) => target[key] ?? (() => {}) });
    const workspace = Object.assign(new EventTarget(), {
        clientWidth: 1024, clientHeight: 768, style: {},
        classList: { toggle() {}, add() {}, remove() {} },
        setPointerCapture() {},
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
        focus() { document.activeElement = workspace; }
    });
    const engine = await import("../wwwroot/cad/engine.js");
    const flush = () => {
        texts.length = 0;
        const callback = frame;
        frame = null;
        callback?.();
    };
    const click = (x, y) => {
        workspace.dispatchEvent(Object.assign(new Event("pointerdown"), {
            button: 0, clientX: x, clientY: y, detail: 1, pointerId: 1
        }));
        workspace.dispatchEvent(Object.assign(new Event("pointerup"), {
            button: 0, clientX: x, clientY: y, detail: 1, pointerId: 1
        }));
        flush();
    };
    try {
        engine.init(workspace, { getContext: () => context }, {
            invokeMethodAsync: (name, ...args) => { calls.push({ name, args }); return Promise.resolve(); }
        }, 1000, 1000);
        flush();
        engine.setTool("ruler");
        click(200, 200);
        click(500, 200);
        engine.rulerAddPoints();
        click(500, 500);
        engine.rulerStop();
        engine.rulerSave();
        engine.setTool("cross");
        flush();
        const saved = engine.getDataText();
        assert.equal(engine.getBuckets().find(b => b.name === "measures").count, 1);
        assert.ok(texts.some(t => t.text.endsWith("²")), "measurement renders with Cross active");

        engine.loadDataText(saved);
        flush();
        const area = texts.find(t => t.text.endsWith("²"));
        click(area.x, area.y);
        assert.equal(calls.findLast(c => c.name === "OnToolChanged").args[0], "cross");
        engine.setTool("select");
        flush();
        click(200, 200);
        assert.equal(calls.findLast(c => c.name === "OnToolChanged").args[0], "select");
        assert.equal(calls.findLast(c => c.name === "OnSelectedMeasurement").args[0].points, 3);
        assert.equal(calls.findLast(c => c.name === "OnSelectionChanged").args[0], 1);
        click(area.x, area.y);
        assert.equal(calls.findLast(c => c.name === "OnToolChanged").args[0], "ruler");
        const info = calls.findLast(c => c.name === "OnMeasureChanged").args[0];
        assert.equal(info.mode, "done");
        assert.equal(info.saved, true);
        assert.equal(info.nodes.length, 3);

        engine.rulerTogglePoint(1);
        engine.rulerSave();
        const measures = JSON.parse(engine.getDataText()).buckets.find(b => b.name === "measures");
        assert.equal(measures.rows.length, 1);
        assert.equal(measures.rows[0][1][1].enabled, false);
        engine.undo();
        const restored = JSON.parse(engine.getDataText()).buckets.find(b => b.name === "measures");
        assert.equal(restored.rows[0][1][1].enabled, true);
        window.confirm = () => false;
        engine.rulerDeleteAll();
        assert.equal(engine.getBuckets().find(b => b.name === "measures").count, 1, "cancel keeps measurements");
        window.confirm = () => true;
        engine.rulerDeleteAll();
        assert.equal(engine.getBuckets().find(b => b.name === "measures").count, 0);
        engine.undo();
        assert.equal(engine.getBuckets().find(b => b.name === "measures").count, 1, "confirmed deletion is undoable");
    } finally {
        engine.dispose();
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.ResizeObserver;
        delete globalThis.requestAnimationFrame;
        delete globalThis.cancelAnimationFrame;
    }
});

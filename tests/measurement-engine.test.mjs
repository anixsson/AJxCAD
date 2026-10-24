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

        assert.equal(engine.rulerAddPoints(), true);
        click(200, 500);
        assert.equal(calls.findLast(c => c.name === "OnMeasureChanged").args[0].nodes.length, 4);
        assert.equal(engine.getDataText(), saved, "continued points remain a draft");
        engine.rulerStop();
        engine.rulerSave();
        const extended = JSON.parse(engine.getDataText()).buckets.find(b => b.name === "measures").rows;
        assert.equal(extended.length, 1, "continues the selected area instead of creating another");
        assert.equal(extended[0][1].length, 4);
        engine.undo();
        assert.equal(engine.getDataText(), saved, "undo restores the original area");
        engine.setTool("select");
        flush();
        click(area.x, area.y);
        engine.rulerTogglePoint(1);
        engine.rulerDeletePoint(1);
        engine.rulerSave();
        const measures = JSON.parse(engine.getDataText()).buckets.find(b => b.name === "measures");
        assert.equal(measures.rows.length, 1);
        assert.equal(measures.rows[0][1].length, 2);
        engine.undo();
        const restored = JSON.parse(engine.getDataText()).buckets.find(b => b.name === "measures");
        assert.equal(restored.rows[0][1][1].enabled, true);
        assert.throws(() => engine.deleteSelectedMeasurement(), /Select a saved measurement/);
        engine.setTool("ruler");
        click(600, 300);
        click(800, 300);
        engine.rulerAddPoints();
        click(800, 600);
        engine.rulerStop();
        assert.throws(() => engine.deleteSelectedMeasurement(), /Select a saved measurement/, "unsaved draft cannot be deleted");
        engine.rulerSave();
        const beforeDelete = JSON.parse(engine.getDataText()).buckets.find(b => b.name === "measures").rows;
        assert.equal(beforeDelete.length, 2);
        engine.setTool("select");
        flush();
        click(200, 200);
        assert.equal(calls.findLast(c => c.name === "OnSelectedMeasurement").args[0].id, beforeDelete[0][0]);
        document.querySelector = () => ({});
        document.querySelectorAll = () => [{
            disabled: false, offsetParent: {},
            click: () => assert.fail("modal must block the workspace default action")
        }];
        const beforeModalKeys = calls.length;
        for (const key of ["Escape", " ", "r", "z", "n", "o", "s"]) {
            document.dispatchEvent(Object.assign(new Event("keydown"), { key, metaKey: true }));
            document.dispatchEvent(Object.assign(new Event("keydown"), { key }));
        }
        assert.equal(calls.length, beforeModalKeys, "modal handles its own keys without invoking workspace commands");
        assert.deepEqual(JSON.parse(engine.getDataText()).buckets.find(b => b.name === "measures").rows,
            beforeDelete, "dismissing a modal without confirmation leaves measurements unchanged");
        document.querySelector = () => null;
        document.querySelectorAll = () => [];
        window.confirm = () => { assert.fail("deletion must not use a native confirmation dialog"); };
        assert.equal(engine.getBuckets().find(b => b.name === "measures").count, 2, "selecting a measurement does not delete it");
        engine.deleteSelectedMeasurement();
        assert.deepEqual(JSON.parse(engine.getDataText()).buckets.find(b => b.name === "measures").rows,
            [beforeDelete[1]], "only the selected measurement is removed");
        assert.equal(calls.findLast(c => c.name === "OnSelectedMeasurement").args[0], null);
        assert.equal(calls.findLast(c => c.name === "OnSelectionChanged").args[0], 0);
        engine.undo();
        assert.deepEqual(JSON.parse(engine.getDataText()).buckets.find(b => b.name === "measures").rows,
            beforeDelete, "confirmed deletion is undoable");
        flush();
        const restoredArea = texts.find(t => t.text.endsWith("²"));
        click(restoredArea.x, restoredArea.y);
        assert.equal(calls.findLast(c => c.name === "OnMeasureChanged").args[0].saved, true);
        engine.deleteSelectedMeasurement();
        assert.equal(engine.getBuckets().find(b => b.name === "measures").count, 1, "editor deletes only its saved measurement");
        assert.equal(calls.findLast(c => c.name === "OnMeasureChanged").args[0], null);
        engine.undo();
        assert.equal(engine.getBuckets().find(b => b.name === "measures").count, 2, "editor deletion is undoable");
    } finally {
        engine.dispose();
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.ResizeObserver;
        delete globalThis.requestAnimationFrame;
        delete globalThis.cancelAnimationFrame;
    }
});

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
        for (const [key, tool] of [["o", "circle"], ["r", "rectangle"], ["t", "text"]]) {
            document.dispatchEvent(Object.assign(new Event("keydown"), { key }));
            assert.equal(calls.findLast(c => c.name === "OnToolChanged").args[0], tool,
                `${key.toUpperCase()} activates ${tool}`);
            if (tool === "circle") {
                click(600, 400);
                assert.equal(calls.findLast(c => c.name === "OnShapeChanged").args[0].type, "circle");
                engine.setShapeDimension("radius", 12.7);
                assert.equal(calls.findLast(c => c.name === "OnShapeChanged").args[0].radius, 12.7);
                engine.useShapeCursor();
                assert.equal(calls.findLast(c => c.name === "OnShapeChanged").args[0].radiusFixed, false);
                click(660, 400);
                assert.equal(calls.findLast(c => c.name === "OnShapeChanged").args[0].directionSet, true);
                engine.saveShape();
                assert.equal(calls.findLast(c => c.name === "OnShapeChanged").args[0], null);
            } else if (tool === "rectangle") {
                click(600, 600);
                engine.setShapeDimension("width", 100);
                engine.setShapeDimension("height", 100);
                engine.cancelShape();
                assert.equal(calls.findLast(c => c.name === "OnShapeChanged").args[0], null);
                click(600, 600);
                engine.setShapeDimension("width", 100);
                engine.setShapeDimension("height", 100);
                click(700, 700);
                engine.saveShape();
                assert.equal(calls.findLast(c => c.name === "OnShapeChanged").args[0], null);
                // Keep the original rectangle's direction for the selection checks below.
                engine.undo();
                click(600, 600);
                click(700, 700);
                engine.saveShape();
            } else {
                click(900, 100);
                const textInfo = calls.findLast(c => c.name === "OnTextChanged").args[0];
                assert.equal(textInfo.x, 380);
                engine.setTextDraft({ ...textInfo, text: "Note" });
                engine.saveText();
                assert.equal(calls.findLast(c => c.name === "OnTextChanged").args[0].mode, "edit");
            }
        }
        const drawingBuckets = engine.getBuckets();
        assert.equal(drawingBuckets.find(b => b.name === "shapes").count, 2);
        assert.equal(drawingBuckets.find(b => b.name === "texts").count, 1);
        engine.setTool("select");
        click(600, 600);
        assert.equal(calls.findLast(c => c.name === "OnShapeChanged").args[0].type, "rectangle");
        assert.ok(calls.findLast(c => c.name === "OnShapeChanged").args[0].id > 0);
        engine.setShapeDimension("width", 125);
        engine.saveShape();
        assert.equal(engine.getBuckets().find(b => b.name === "shapes").count, 2);
        engine.undo();
        assert.equal(calls.findLast(c => c.name === "OnShapeChanged").args[0], null);
        click(600, 400);
        assert.equal(calls.findLast(c => c.name === "OnShapeChanged").args[0].type, "circle");
        engine.setShapeDimension("radius", 25);
        assert.equal(engine.cancelCurrent(), true);
        assert.equal(calls.findLast(c => c.name === "OnShapeChanged").args[0], null);
        click(100, 100);
        const textBefore = JSON.parse(engine.getDataText()).buckets.find(b => b.name === "texts").rows[0];
        const pointer = (type, x, y) => workspace.dispatchEvent(Object.assign(new Event(type), {
            button: 0, clientX: x, clientY: y, detail: 1, pointerId: 1
        }));
        pointer("pointerdown", 900, 100);
        pointer("pointermove", 1000, 100);
        pointer("pointerup", 1000, 100);
        flush();
        assert.equal(calls.findLast(c => c.name === "OnToolChanged").args[0], "select",
            "Select stays active while text is edited");
        assert.equal(calls.findLast(c => c.name === "OnTextChanged").args[0].mode, "edit",
            "selecting a text label opens its information box");
        const textAfter = JSON.parse(engine.getDataText()).buckets.find(b => b.name === "texts").rows[0];
        assert.notDeepEqual(textAfter, textBefore, "dragging the text origin moves it");
        assert.equal(engine.removeSelectedItems(), 1, "the selected text can be deleted");
        assert.equal(calls.findLast(c => c.name === "OnTextChanged").args[0], null,
            "deleting the text closes its information box");
        assert.equal(engine.getBuckets().find(b => b.name === "texts").count, 0);
        engine.undo();
        assert.equal(engine.getBuckets().find(b => b.name === "texts").count, 1);
        pointer("pointerdown", 1000, 100);
        pointer("pointerup", 1000, 100);
        flush();
        assert.equal(engine.cancelCurrent(), true, "Esc closes the text information box");
        assert.equal(calls.findLast(c => c.name === "OnTextChanged").args[0], null);
        document.dispatchEvent(Object.assign(new Event("keydown"), { key: "m" }));
        assert.equal(calls.findLast(c => c.name === "OnToolChanged").args[0], "measurement",
            "M activates the Measurement tool");
        click(200, 200);
        click(500, 200);
        engine.measurementAddPoints();
        click(500, 500);
        engine.measurementStop();
        engine.measurementSave();
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
        assert.equal(calls.findLast(c => c.name === "OnToolChanged").args[0], "measurement");
        const info = calls.findLast(c => c.name === "OnMeasureChanged").args[0];
        assert.equal(info.mode, "done");
        assert.equal(info.saved, true);
        assert.equal(info.nodes.length, 3);

        assert.equal(engine.measurementAddPoints(), true);
        click(200, 500);
        assert.equal(calls.findLast(c => c.name === "OnMeasureChanged").args[0].nodes.length, 4);
        assert.equal(engine.getDataText(), saved, "continued points remain a draft");
        engine.measurementStop();
        engine.measurementSave();
        const extended = JSON.parse(engine.getDataText()).buckets.find(b => b.name === "measures").rows;
        assert.equal(extended.length, 1, "continues the selected area instead of creating another");
        assert.equal(extended[0][1].length, 4);
        engine.undo();
        assert.equal(engine.getDataText(), saved, "undo restores the original area");
        engine.setTool("select");
        flush();
        click(area.x, area.y);
        engine.measurementTogglePoint(1);
        engine.measurementDeletePoint(1);
        engine.measurementSave();
        const measures = JSON.parse(engine.getDataText()).buckets.find(b => b.name === "measures");
        assert.equal(measures.rows.length, 1);
        assert.equal(measures.rows[0][1].length, 2);
        engine.undo();
        const restored = JSON.parse(engine.getDataText()).buckets.find(b => b.name === "measures");
        assert.equal(restored.rows[0][1][1].enabled, true);
        assert.throws(() => engine.deleteSelectedMeasurement(), /Select a saved measurement/);
        engine.setTool("measurement");
        click(600, 300);
        click(800, 300);
        engine.measurementAddPoints();
        click(800, 600);
        engine.measurementStop();
        assert.throws(() => engine.deleteSelectedMeasurement(), /Select a saved measurement/, "unsaved draft cannot be deleted");
        engine.measurementSave();
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
        for (const key of ["Escape", " ", "m", "z", "n", "o", "s"]) {
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

        engine.setTool("select");
        flush();
        click(200, 200);
        assert.equal(calls.findLast(c => c.name === "OnSelectionChanged").args[0], 1);
        const defaultLayer = engine.getLayers().activeId;
        engine.createLayer();
        const newLayer = engine.getLayers().activeId;
        engine.editLayer(newLayer, { name: "Notes" });
        engine.moveSelectionToLayer(newLayer);
        const withLayers = JSON.parse(engine.getDataText()).buckets.find(b => b.name === "measures");
        assert.equal(withLayers.rows[0][withLayers.fields.indexOf("layerId")], newLayer,
            "creating and renaming a layer preserves the selection for assignment");
        assert.equal(withLayers.rows[1][withLayers.fields.indexOf("layerId")], defaultLayer);
        engine.editLayer(newLayer, { visible: false });
        flush();
        click(200, 200);
        assert.equal(calls.findLast(c => c.name === "OnSelectionChanged").args[0], 0,
            "hidden measurements cannot be selected");
        assert.equal(texts.filter(t => t.text.endsWith("²")).length, 1, "hidden area is not rendered");
        engine.editLayer(newLayer, { visible: true });
        flush();
        assert.equal(texts.filter(t => t.text.endsWith("²")).length, 2);
        engine.setTool("cross");
        engine.selectLayerItems(newLayer);
        assert.equal(calls.findLast(c => c.name === "OnToolChanged").args[0], "select");
        assert.equal(calls.findLast(c => c.name === "OnSelectionChanged").args[0], 3);
        assert.equal(engine.getLayers().activeId, newLayer);
        engine.editLayer(newLayer, { visible: false });
        assert.throws(() => engine.selectLayerItems(newLayer), /Show the layer/);
        engine.editLayer(newLayer, { visible: true });

        engine.startPlacePage();
        click(512, 384);
        const pageId = engine.getPages().selectedId;
        engine.editLayer(newLayer, { printable: false });
        assert.ok(engine.getPagePdf(pageId).pdf.startsWith("%PDF"), "pages do not depend on layer print settings");
        engine.activateLayer(defaultLayer);
        assert.throws(() => engine.moveSelectionToLayer(defaultLayer), /Select board items/, "pages cannot be assigned to layers");
        engine.setPagePreview(true);
        flush();
        assert.equal(texts.filter(t => t.text.endsWith("²")).length, 1,
            "print preview omits visible but non-printing annotations");
        assert.ok(engine.getPagePdf(pageId).pdf.startsWith("%PDF"));
        engine.setPagePreview(false);
        const layeredProject = engine.getDataText();
        engine.loadDataText(layeredProject);
        assert.equal(engine.getLayers().layers.find(l => l.id === newLayer).printable, false);
        engine.removeLayer(newLayer);
        assert.deepEqual(engine.getLayers().layers.map(layer => layer.id), [defaultLayer]);
        assert.equal(engine.getLayers().layers[0].name, "Layer 0");
        const measuresAfterLayerRemoval = JSON.parse(engine.getDataText()).buckets.find(b => b.name === "measures");
        assert.equal(measuresAfterLayerRemoval.rows[0][measuresAfterLayerRemoval.fields.indexOf("layerId")], defaultLayer,
            "removing a layer moves its measurements to Layer 0");
        engine.undo();
        assert.equal(engine.getLayers().layers.length, 2, "undo restores a removed layer");
        engine.newProject();
        assert.equal(engine.getLayers().layers.length, 1);
        assert.equal(engine.getLayers().layers[0].name, "Layer 0");
        engine.undo();
        assert.equal(engine.getLayers().layers.length, 2, "undo New restores the layer bucket");
    } finally {
        engine.dispose();
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.ResizeObserver;
        delete globalThis.requestAnimationFrame;
        delete globalThis.cancelAnimationFrame;
    }
});

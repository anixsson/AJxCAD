import test from "node:test";
import assert from "node:assert/strict";
import { bucket, clearAll, describe, serialize, deserialize, undo } from "../wwwroot/cad/store.js";
import { LAYERS, normalizeLayers, layerState, activeLayerId, addLayer, setActiveLayer, updateLayer, assignLayer, visibleItems, layerVisible, layerPrintable } from "../wwwroot/cad/layers.js";
import { addLine, lineGeometry } from "../wwwroot/cad/lines.js";
import { addShape, shapeGeometry, SHAPES } from "../wwwroot/cad/shapes.js";
import { addText, textGeometry, TEXTS } from "../wwwroot/cad/text.js";
import { addPoint, POINTS } from "../wwwroot/cad/points.js";
import { addPage, PAGES } from "../wwwroot/cad/pages.js";
import { createMeasurementTool, measurementGeometry, MEASURES } from "../wwwroot/cad/tools/measurement.js";
import { createSelectTool } from "../wwwroot/cad/tools/select.js";
import { createPageTool } from "../wwwroot/cad/tools/page.js";
import { pagePdf } from "../wwwroot/cad/pdf.js";

function reset() {
    clearAll();
    normalizeLayers();
    return activeLayerId();
}

function environment(extra = {}) {
    return {
        geometries: [lineGeometry],
        selectionGeometries: [lineGeometry, measurementGeometry],
        toScreen: (x, y) => ({ x, y }),
        toWorld: (x, y) => ({ x, y }),
        snap: (x, y) => ({ x, y }),
        formatLength: x => `${x} mm`,
        formatArea: x => `${x} mm2`,
        redraw() {}, capture() {}, log() {},
        viewSizeMm: () => ({ w: 1000, h: 1000 }),
        ...extra
    };
}
const pointer = (sx, sy) => ({ sx, sy, pointerId: 1 });

test("Pages and Layers are project buckets; drawing tools own their buckets", () => {
    const buckets = describe();
    assert.equal(buckets.find(b => b.name === PAGES).group, "project");
    assert.equal(buckets.find(b => b.name === LAYERS).group, "project");
    assert.equal(buckets.find(b => b.name === "project").group, "project");
    assert.equal(buckets.some(b => b.name === "pointSettings"), false);
    assert.deepEqual(buckets.filter(b => b.group === "tool").map(b => b.name).sort(), ["lines", "measures", POINTS, SHAPES, TEXTS]);
    const tool = createMeasurementTool(environment());
    assert.equal(tool.id, "measurement");
    assert.equal(tool.hotkey, "m");
});

test("new lines, shapes, text, points and measurements use the active layer; splitting preserves its source layer", () => {
    const first = reset();
    const original = addLine(0, 0, 100, 0);
    addLayer();
    const active = activeLayerId();
    assert.notEqual(active, first);
    assert.equal(addLine(0, 20, 100, 20).layerId, active);
    assert.equal(addShape("circle", { x: 5, y: 5 }, { x: 10, y: 5 }).layerId, active);
    assert.equal(addText("Label", 5, 5).layerId, active);
    assert.equal(addPoint(5, 5).layerId, active);
    assert.equal(Object.hasOwn(addPage({}), "layerId"), false);
    const measurement = createMeasurementTool(environment());
    measurement.pointerDown(pointer(0, 0));
    measurement.pointerDown(pointer(100, 0));
    measurement.save();
    assert.equal(bucket(MEASURES).items[0].layerId, active);
    assert.equal(lineGeometry.split(original, 50, 0).added.layerId, first);
});

test("layer names and checkbox settings validate, persist and undo", () => {
    reset();
    addLayer();
    const id = activeLayerId();
    updateLayer(id, { name: "  Notes  ", visible: false, printable: false });
    const text = serialize();
    const layer = layerState().layers.find(l => l.id === id);
    assert.deepEqual(layer, { id, name: "Notes", visible: false, printable: false });
    assert.throws(() => updateLayer(id, { name: " " }), /cannot be empty/);
    assert.throws(() => updateLayer(id, { visible: "false" }), /checkbox/);
    assert.throws(() => updateLayer(id, { color: "red" }), /Unknown layer setting/);
    assert.throws(() => setActiveLayer(-1), /Unknown layer/);
    assert.deepEqual(layerState().layers.find(l => l.id === id), layer, "invalid requests do not modify settings");
    undo();
    assert.equal(layerState().layers.find(l => l.id === id).name, "Layer 1");
    deserialize(text);
    normalizeLayers();
    assert.deepEqual(layerState().layers.find(l => l.id === id), layer);
});

test("older files migrate to a visible printable default layer", () => {
    reset();
    deserialize(JSON.stringify({
        app: "ajxcad", format: 1, buckets: [
            { name: "lines", fields: ["id", "x1", "y1", "x2", "y2"], rows: [[100, 0, 0, 100, 0]] },
            { name: "measures", fields: ["id", "points"], rows: [[101, [{ x: 0, y: 0 }, { x: 50, y: 50 }]]] },
            { name: "pages", fields: ["id", "layerId"], rows: [[102, 999]] }
        ]
    }));
    normalizeLayers();
    const { layers, activeId } = layerState();
    assert.deepEqual(layers, [{ id: activeId, name: "Default", visible: true, printable: true }]);
    for (const name of ["lines", "measures"]) assert.equal(bucket(name).items[0].layerId, activeId);
    assert.equal(Object.hasOwn(bucket(PAGES).items[0], "layerId"), false, "old page membership is discarded");
    const text = serialize();
    deserialize(text);
    normalizeLayers();
    assert.equal(serialize(), text, "migration is stable on subsequent loads");
});

test("invalid layer references fail explicitly rather than changing membership", () => {
    reset();
    const line = addLine(0, 0, 100, 0);
    line.layerId = 999;
    assert.throws(() => normalizeLayers(), /Unknown layer 999 in lines/);
    assert.throws(() => layerVisible(line), /Unknown layer/);
    assert.equal(line.layerId, 999);
});

test("layer assignment changes whole selected items once and is undoable", () => {
    const first = reset();
    const line = addLine(0, 0, 100, 0);
    addLayer();
    const target = activeLayerId();
    const select = createSelectTool(environment());
    select.pointerDown(pointer(0, 0));
    select.pointerUp(pointer(0, 0));
    assert.deepEqual(select.selectedLayerItems(), [line]);
    assert.equal(assignLayer([...select.selectedLayerItems(), line], target), 1);
    assert.equal(line.layerId, target);
    assert.equal(undo(), true);
    assert.equal(bucket("lines").items[0].layerId, first);
    assert.throws(() => assignLayer([], target), /Select board items/);
    assert.throws(() => assignLayer([line], -1), /Unknown layer/);
});

test("hidden layers are excluded from node, line, rectangle and measurement node picking", () => {
    const hidden = reset();
    addLine(0, 0, 100, 0);
    const measurement = createMeasurementTool(environment());
    measurement.pointerDown(pointer(0, 0));
    measurement.pointerDown(pointer(100, 0));
    measurement.save();
    updateLayer(hidden, { visible: false });
    assert.equal(visibleItems("lines").length, 0);
    let info;
    const nodes = createMeasurementTool(environment({ measureChanged: v => { info = v; } }));
    nodes.setSnapMode("nodes");
    nodes.pointerDown(pointer(0, 0));
    nodes.pointerDown(pointer(100, 0));
    assert.equal(info, undefined);
    for (const mode of ["nodes", "lines"]) {
        const select = createSelectTool(environment());
        select.setSelectionMode(mode);
        for (const p of [pointer(0, 0), pointer(50, 0)]) {
            select.pointerDown(p);
            select.pointerUp(p);
            assert.deepEqual(select.selectedLayerItems(), []);
        }
        select.pointerDown(pointer(-20, -20));
        select.pointerMove(pointer(120, 20));
        select.pointerUp(pointer(120, 20));
        assert.deepEqual(select.selectedLayerItems(), []);
    }
});

test("selecting a layer replaces selection with all its line and measurement points, excluding pages", () => {
    const first = reset();
    const line = addLine(0, 0, 100, 0);
    addPage({});
    const measurement = createMeasurementTool(environment());
    measurement.pointerDown(pointer(0, 20));
    measurement.pointerDown(pointer(100, 20));
    measurement.save();
    const measure = bucket(MEASURES).items[0];
    addLayer();
    const second = activeLayerId();
    const other = addLine(200, 0, 300, 0);
    let count;
    const select = createSelectTool(environment({ selectionChanged: value => { count = value; } }));
    select.selectLayer(second);
    assert.deepEqual(select.selectedLayerItems(), [other]);
    select.selectLayer(first);
    assert.deepEqual(new Set(select.selectedLayerItems()), new Set([line, measure]));
    assert.equal(count, 4);
    updateLayer(first, { visible: false });
    select.selectLayer(first);
    assert.deepEqual(select.selectedLayerItems(), []);
    assert.equal(count, 0);
});

test("page visibility and picking are independent of layer visibility", () => {
    const id = reset();
    const page = addPage({});
    const tool = createPageTool(environment());
    tool.select(page.id);
    updateLayer(id, { visible: false });
    assert.equal(tool.edgeAt(105, 0), page.id);
    let calls = 0;
    const g = new Proxy({}, { get: (_, key) => key === "measureText"
        ? text => ({ width: text.length * 7 })
        : () => { calls++; } });
    tool.drawSaved(g, { dpr: 1, width: 1000, height: 1000, toScreen: (x, y) => ({ x: 500 + x, y: 500 - y }) });
    assert.ok(calls > 0);
    tool.dataChanged();
    assert.equal(tool.selectedId(), page.id);
    assert.equal(bucket(PAGES).items.length, 1, "hiding never deletes data");
});

test("visibility and print flags filter lines and measurements in PDF output", () => {
    const id = reset();
    const page = { paper: "A4", scale: 1, x: 0, y: 0 };
    const line = addLine(0, 0, 50, 0);
    const measurement = createMeasurementTool(environment());
    measurement.pointerDown(pointer(0, 0));
    measurement.pointerDown(pointer(50, 0));
    measurement.save();
    const measures = bucket(MEASURES).items;
    const empty = pagePdf(page, [], []);
    for (const [visible, printable] of [[true, true], [true, false], [false, true], [false, false]]) {
        updateLayer(id, { visible, printable });
        assert.equal(layerVisible(line), visible);
        assert.equal(layerPrintable(line), visible && printable);
        const pdf = pagePdf(page, [line], measures);
        if (visible && printable) assert.notEqual(pdf, empty);
        else assert.equal(pdf, empty, `${visible}/${printable} emits no drawing or measurement marks`);
    }
});

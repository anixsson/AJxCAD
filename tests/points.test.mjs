import test from "node:test";
import assert from "node:assert/strict";
import { bucket, clearAll, serialize, deserialize, undo } from "../wwwroot/cad/store.js";
import { normalizeLayers, activeLayerId, updateLayer } from "../wwwroot/cad/layers.js";
import {
    POINTS, addPoint, pointSettings, setPointSettings, setPointMarker,
    markerVisible, pointGeometry, createPointTool
} from "../wwwroot/cad/points.js";
import { pagePdf } from "../wwwroot/cad/pdf.js";

function reset() {
    clearAll();
    normalizeLayers();
}

test("point placement snaps, uses the active layer, publishes information and is undoable", () => {
    reset();
    const changes = [];
    const tool = createPointTool({
        snap: () => ({ x: 20, y: 30, kind: "end" }),
        pointChanged: info => changes.push(info), redraw() {}, log() {}
    });
    assert.equal(tool.hotkey, "n");
    tool.activate();
    assert.deepEqual(changes.at(-1), { scale: 100, visibility: "local", point: null });
    tool.pointerDown({ sx: 123, sy: 456 });
    const item = bucket(POINTS).items[0];
    assert.deepEqual(item, { id: item.id, x: 20, y: 30, showMarker: true, layerId: activeLayerId() });
    assert.deepEqual(changes.at(-1).point, item);
    assert.equal(undo(), true);
    assert.equal(bucket(POINTS).items.length, 0);
    tool.dataChanged();
    assert.equal(changes.at(-1).point, null);
    assert.throws(() => addPoint(NaN, 0), /finite/);
});

test("global overrides preserve local visibility, serialize, and undo with scale changes", () => {
    reset();
    const point = addPoint(1, 2);
    setPointMarker(point.id, false);
    assert.equal(markerVisible(point), false);
    setPointSettings(200, "on");
    assert.equal(markerVisible(point), true);
    assert.equal(point.showMarker, false);
    setPointSettings(400, "off");
    assert.equal(markerVisible({ ...point, showMarker: true }), false);
    const saved = serialize();
    deserialize(saved);
    assert.deepEqual(pointSettings(), { scale: 400, visibility: "off" });
    assert.equal(bucket(POINTS).items[0].showMarker, false);
    setPointSettings(100, "local");
    assert.equal(markerVisible(bucket(POINTS).items[0]), false);
    undo();
    assert.deepEqual(pointSettings(), { scale: 400, visibility: "off" });
    for (const scale of [0, 26, 401, NaN])
        assert.throws(() => setPointSettings(scale, "local"), /scale/);
    assert.throws(() => setPointSettings(100, "invalid"), /override/);
    assert.throws(() => setPointMarker(-1, true), /Unknown/);
    assert.throws(() => setPointMarker(point.id, 1), /checkbox/);
    reset();
    assert.deepEqual(pointSettings(), { scale: 100, visibility: "local" });
});

test("marker is fixed-size across zoom, has opposite red quadrants and extended crosshairs", () => {
    reset();
    const item = addPoint(20, 30);
    for (const scale of [0.1, 1, 100]) {
        const arcs = [], lines = [], colors = [];
        const context = new Proxy({
            arc: (...args) => arcs.push(args), lineTo: (...args) => lines.push(args),
            fill() { colors.push(this.fillStyle); }
        }, { get: (target, key) => target[key] ?? (() => {}) });
        pointGeometry.draw(context, [item], { scale, dpr: 2, toScreen: () => ({ x: 100, y: 100 }) });
        assert.ok(arcs.every(a => a[2] === 12), "radius ignores world zoom");
        assert.deepEqual(colors, ["#fff", "#e02020", "#e02020"]);
        assert.equal(arcs[1][3], 0);
        assert.equal(arcs[2][3], Math.PI);
        assert.ok(lines.some(([x, y]) => x === 218 && y === 200), "cross extends past radius 12");
    }
    setPointMarker(item.id, false);
    pointGeometry.draw({ arc() { assert.fail("hidden point drew an arc"); } }, [item], { dpr: 1 });
    assert.deepEqual(pointGeometry.points(item), [{ key: "point", x: 20, y: 30 }]);
    assert.equal(pointGeometry.hitTest(item, 20, 30, { toScreen: (x, y) => ({ x, y }) }), 0);
    pointGeometry.setPoint(item, "point", 40, 50);
    assert.deepEqual([item.x, item.y], [40, 50]);
});

test("PDF includes visible vector points at fixed paper size and respects overrides and layers", () => {
    reset();
    const item = addPoint(0, 0);
    const pdf = (scale = 10) => pagePdf({ paper: "A4", x: 0, y: 0, scale }, [], [], undefined, [], [], [item]);
    const color = /0\.878 0\.125 0\.125 rg/g;
    for (const scale of [1, 10, 50]) {
        assert.equal((pdf(scale).match(color) ?? []).length, 1);
        assert.match(pdf(scale), /q 0 G 1 g 0\.75 w \[\] 0 d/);
        assert.match(pdf(scale), /302\.138 420\.945 m/); // centre + 4.5 pt radius
    }
    setPointMarker(item.id, false);
    assert.equal((pdf().match(color) ?? []).length, 0);
    setPointSettings(200, "on");
    assert.equal((pdf().match(color) ?? []).length, 1);
    assert.match(pdf(), /q 0 G 1 g 1\.5 w/);
    setPointSettings(100, "off");
    assert.equal((pdf().match(color) ?? []).length, 0);
    setPointSettings(100, "on");
    updateLayer(item.layerId, { printable: false });
    assert.equal((pdf().match(color) ?? []).length, 0);
});

test("engine Point tool integrates grid/node snapping, selection, movement, deletion and export", async () => {
    reset();
    const changes = [];
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
    engine.init(workspace, { getContext: () => ({}) }, {
        invokeMethodAsync: (name, info) => { if (name === "OnPointChanged") changes.push(info); return Promise.resolve(); }
    }, 1000, 1000);
    try {
        engine.setTool("point");
        click(612, 384);
        const item = bucket(POINTS).items[0];
        assert.deepEqual([item.x, item.y], [100, 0]);
        addLine(203, 97, 300, 200);
        click(716, 286);
        assert.deepEqual([bucket(POINTS).items[1].x, bucket(POINTS).items[1].y], [203, 97]);
        engine.setTool("select");
        click(612, 384);
        assert.equal(changes.at(-1).point.id, item.id);
        engine.updatePointMarker(item.id, false);
        engine.updatePointSettings(150, "on");
        assert.equal(changes.at(-1).point.showMarker, false);
        assert.equal(changes.at(-1).scale, 150);
        pointer("pointerdown", 612, 384);
        pointer("pointermove", 652, 424);
        pointer("pointerup", 652, 424);
        assert.notDeepEqual([item.x, item.y], [100, 0]);
        assert.equal(changes.at(-1).point.x, item.x);
        engine.updatePointSettings(150, "off");
        click(900, 700);
        engine.setSelectionMode("lines");
        click(512 + item.x, 384 - item.y);
        assert.equal(changes.at(-1).point.id, item.id, "a hidden point is selectable in Lines mode too");
        assert.equal(engine.removeSelectedItems(), 1);
        assert.equal(bucket(POINTS).items.length, 1);
        assert.equal(changes.at(-1).point, null);
        engine.undo();
        assert.equal(bucket(POINTS).items.length, 2);
    } finally {
        engine.dispose();
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.ResizeObserver;
        delete globalThis.requestAnimationFrame;
        delete globalThis.cancelAnimationFrame;
    }
});

import test from "node:test";
import assert from "node:assert/strict";
import { generateLines, generateTestItems } from "../wwwroot/cad/test-data.js";

function seededRandom() {
    let seed = 12345;
    return () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
}

test("generates the exact requested count of finite, non-zero lines inside the viewport border", () => {
    for (const [width, height] of [[1024, 768], [101, 101], [400, 900]]) {
        const lines = generateLines(10000, 200, width, height, seededRandom());
        assert.equal(lines.length, 10000);
        for (const line of lines) {
            for (const x of [line.x1, line.x2]) assert.ok(Number.isFinite(x) && x >= 48 && x <= width - 48);
            for (const y of [line.y1, line.y2]) assert.ok(Number.isFinite(y) && y >= 48 && y <= height - 48);
            assert.ok(Math.hypot(line.x2 - line.x1, line.y2 - line.y1) > 0);
        }
    }
});

test("spacing controls successive centres and zero spacing keeps the same centre", () => {
    for (const spacing of [0, 10, 200]) {
        const lines = generateLines(2, spacing, 2000, 2000, () => 0.5);
        const centres = lines.map(l => ({ x: (l.x1 + l.x2) / 2, y: (l.y1 + l.y2) / 2 }));
        assert.equal(Math.hypot(centres[1].x - centres[0].x, centres[1].y - centres[0].y), spacing);
    }
});

test("random directions and lengths vary while generated lines remain separate", () => {
    const lines = generateLines(100, 24, 1024, 768, seededRandom());
    assert.ok(new Set(lines.map(l => Math.atan2(l.y2 - l.y1, l.x2 - l.x1))).size > 90);
    assert.ok(new Set(lines.map(l => Math.hypot(l.x2 - l.x1, l.y2 - l.y1))).size > 90);
    assert.ok(lines.slice(1).every((l, i) => l.x1 !== lines[i].x2 || l.y1 !== lines[i].y2));
});

test("rejects invalid counts, spacing and workspace dimensions explicitly", () => {
    for (const count of [0, -1, 1.5, 10001, NaN, Infinity])
        assert.throws(() => generateLines(count, 24, 1024, 768), /count/);
    for (const spacing of [-1, 201, NaN, Infinity])
        assert.throws(() => generateLines(100, spacing, 1024, 768), /Spacing/);
    for (const [width, height] of [[100, 768], [1024, 0], [NaN, 768], [1024, Infinity]])
        assert.throws(() => generateLines(100, 24, width, height), /workspace/);
});

test("other tools generate the requested bounded, non-degenerate geometry", () => {
    for (const kind of ["circle", "rectangle", "text", "measurement", "point"]) {
        for (const [width, height] of [[1024, 768], [101, 101]]) {
            const items = generateTestItems(kind, 10000, 200, width, height, seededRandom());
            assert.equal(items.length, 10000);
            const bounded = p => {
                assert.ok(Number.isFinite(p.x) && p.x >= 48 - 1e-9 && p.x <= width - 48 + 1e-9);
                assert.ok(Number.isFinite(p.y) && p.y >= 48 - 1e-9 && p.y <= height - 48 + 1e-9);
            };
            for (const item of items) {
                if (kind === "point") {
                    bounded(item);
                } else if (kind === "circle") {
                    const radius = item.x2 - item.x1;
                    assert.ok(radius > 0);
                    bounded({ x: item.x1 - radius, y: item.y1 - radius });
                    bounded({ x: item.x1 + radius, y: item.y1 + radius });
                } else if (kind === "rectangle") {
                    assert.ok(item.x2 > item.x1 && item.y2 > item.y1);
                    bounded({ x: item.x1, y: item.y1 });
                    bounded({ x: item.x2, y: item.y2 });
                } else if (kind === "text") {
                    bounded(item);
                    assert.ok(item.fontSize > 0);
                    assert.match(item.text, /^Text \d+$/);
                    assert.ok(["sans-serif", "serif", "monospace"].includes(item.fontFamily));
                } else {
                    item.points.forEach(bounded);
                    assert.ok([2, 3].includes(item.points.length));
                    if (item.dimension) bounded(item.dimension);
                }
            }
        }
        assert.throws(() => generateTestItems(kind, 0, 24, 1024, 768), /count/);
        assert.throws(() => generateTestItems(kind, 1, -1, 1024, 768), /Spacing/);
    }
    assert.throws(() => generateTestItems("unknown", 10, 24, 1024, 768), /Unknown/);
});

test("engine adds bounded world-space lines, serializes them and undoes only the generated batch", async () => {
    globalThis.window = Object.assign(new EventTarget(), { devicePixelRatio: 1 });
    globalThis.document = Object.assign(new EventTarget(), {
        hasFocus: () => true,
        activeElement: { tagName: "BODY" }
    });
    globalThis.ResizeObserver = class {
        observe() {}
        disconnect() {}
    };
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};

    const engine = await import("../wwwroot/cad/engine.js");
    const { bucket, serialize } = await import("../wwwroot/cad/store.js");
    const { addLine } = await import("../wwwroot/cad/lines.js");
    const width = 1024, height = 768;
    const workspace = Object.assign(new EventTarget(), {
        clientWidth: width,
        clientHeight: height,
        style: {},
        classList: { toggle() {}, add() {}, remove() {} }
    });
    const canvas = { width, height, getContext: () => ({}) };
    engine.init(workspace, canvas, { invokeMethodAsync: () => Promise.resolve() }, 160, 1000);
    try {
        const original = addLine(-10, -20, 30, 40);
        engine.setTool("line");
        engine.generateTestLines(10000, 150);
        const lines = bucket("lines").items;
        assert.equal(lines.length, 10001);
        for (const line of lines.slice(1)) {
            for (const x of [line.x1, line.x2]) {
                const screenX = width / 2 + x * 0.16;
                assert.ok(screenX >= 48 && screenX <= width - 48);
            }
            for (const y of [line.y1, line.y2]) {
                const screenY = height / 2 - y * 0.16;
                assert.ok(screenY >= 48 && screenY <= height - 48);
            }
        }
        const saved = JSON.parse(engine.getDataText()).buckets.find(b => b.name === "lines");
        assert.equal(saved.rows.length, 10001);
        const info = engine.getBuckets().find(b => b.name === "lines");
        assert.equal(info.count, 10001);
        assert.equal(Object.hasOwn(info, "text"), false);
        const firstPage = engine.getBucketPage("lines", 0);
        assert.equal(firstPage.count, 100);
        assert.deepEqual(JSON.parse(firstPage.text).rows, saved.rows.slice(0, 100));
        const lastPage = engine.getBucketPage("lines", 10000);
        assert.equal(lastPage.count, 1);
        assert.deepEqual(JSON.parse(lastPage.text).rows, saved.rows.slice(10000));
        engine.undo();
        assert.deepEqual(bucket("lines").items, [original]);

        const beforeInvalid = serialize();
        assert.throws(() => engine.generateTestLines(10001, 24), /count/);
        assert.equal(serialize(), beforeInvalid);

        const { addLayer, activeLayerId } = await import("../wwwroot/cad/layers.js");
        addLayer();
        const layerId = activeLayerId();
        for (const [kind, name] of [["circle", "shapes"], ["rectangle", "shapes"], ["text", "texts"], ["measurement", "measures"], ["point", "points"]]) {
            const before = serialize();
            engine.generateTestData(kind, 100, 24);
            const items = bucket(name).items;
            assert.equal(items.length, 100);
            assert.ok(items.every(item => item.layerId === layerId));
            assert.equal(new Set(items.map(item => item.id)).size, 100);
            if (kind === "text") {
                assert.equal(new Set(items.map(item => item.fontFamily)).size, 3);
                assert.ok(items.every(item => item.fontSize > 0 && Number.isFinite(item.x) && Number.isFinite(item.y)));
            } else if (kind === "measurement") {
                assert.equal(items.filter(item => item.dimension).length, 50);
                assert.equal(items.filter(item => item.points.length === 3).length, 50);
            } else if (kind === "point") {
                assert.ok(items.every(item => item.showMarker === true && Number.isFinite(item.x) && Number.isFinite(item.y)));
            } else {
                assert.ok(items.every(item => item.type === kind));
            }
            const savedItems = JSON.parse(engine.getDataText()).buckets.find(b => b.name === name);
            assert.equal(savedItems.rows.length, 100);
            engine.undo();
            assert.equal(serialize(), before, "one undo restores all existing data");
            const beforeInvalidBatch = serialize();
            assert.throws(() => engine.generateTestData(kind, 0, 24), /count/);
            assert.equal(serialize(), beforeInvalidBatch);
        }
    } finally {
        engine.dispose();
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.ResizeObserver;
        delete globalThis.requestAnimationFrame;
        delete globalThis.cancelAnimationFrame;
    }
});

import test from "node:test";
import assert from "node:assert/strict";
import { generateLines } from "../wwwroot/cad/test-data.js";

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
    } finally {
        engine.dispose();
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.ResizeObserver;
        delete globalThis.requestAnimationFrame;
        delete globalThis.cancelAnimationFrame;
    }
});

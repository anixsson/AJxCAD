import test from "node:test";
import assert from "node:assert/strict";

test("extended zoom clamps every view entry point and custom grid color leaves axes and PDF unchanged", async () => {
    const frames = new Map(), calls = [], colors = [];
    let nextFrame = 0;
    globalThis.window = Object.assign(new EventTarget(), { devicePixelRatio: 1 });
    globalThis.document = Object.assign(new EventTarget(), {
        hasFocus: () => true, activeElement: { tagName: "BODY" },
        querySelector: () => null, querySelectorAll: () => []
    });
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
    globalThis.cancelAnimationFrame = id => frames.delete(id);
    const context = new Proxy({
        measureText: text => ({ width: text.length * 7 })
    }, {
        get: (target, key) => target[key] ?? (() => {}),
        set(target, key, value) {
            if (key === "fillStyle") colors.push(value);
            target[key] = value;
            return true;
        }
    });
    const workspace = Object.assign(new EventTarget(), {
        clientWidth: 1024, clientHeight: 768, style: {},
        classList: { toggle() {}, add() {}, remove() {} }
    });
    const flush = () => {
        for (let i = 0; frames.size && i < 10; i++) {
            const batch = [...frames.values()];
            frames.clear();
            for (const callback of batch) callback(performance.now() + 1000);
        }
        assert.equal(frames.size, 0);
    };
    const engine = await import("../wwwroot/cad/engine.js");
    const { addPage } = await import("../wwwroot/cad/pages.js");
    const { updateProject } = await import("../wwwroot/cad/project.js");
    const scale = () => calls.findLast(c => c.name === "OnScaleChanged").args[0];
    engine.init(workspace, { getContext: () => context }, {
        invokeMethodAsync: (name, ...args) => { calls.push({ name, args }); return Promise.resolve(); }
    }, 1000, 1000);
    try {
        flush();
        engine.zoomBy(1e9);
        flush();
        assert.equal(scale(), 100);
        engine.zoomBy(1e-12);
        flush();
        assert.equal(scale(), 0.001);
        engine.setExtendedZoom(true);
        engine.zoomBy(1e9);
        flush();
        assert.equal(scale(), 1000);
        engine.zoomBy(1e-12);
        flush();
        assert.equal(scale(), 0.0001);
        engine.setExtendedZoom(false);
        flush();
        assert.equal(scale(), 0.001, "disabling clamps current zoom");
        engine.setScale(1e9);
        flush();
        assert.equal(scale(), 100);
        engine.setScale(1e-9);
        flush();
        assert.ok(Math.abs(scale() - 0.001) < 1e-12);
        engine.setExtendedZoom(true);
        updateProject({ viewZoom: 1000, viewX: 20, viewY: 30 });
        engine.restoreView();
        flush();
        assert.ok(Math.abs(scale() - 1000) < 1e-9);
        engine.setExtendedZoom(false);
        flush();
        assert.equal(scale(), 100);
        updateProject({ viewZoom: 1000 });
        engine.restoreView();
        flush();
        assert.equal(scale(), 100);
        const page = addPage({ paper: "A4", scale: 10 });
        const pdf = engine.getPagePdf(page.id).pdf;
        engine.setScale(1);
        flush();
        engine.setGridColor("#123456");
        colors.length = 0;
        flush();
        assert.ok(colors.includes("#12345626"));
        assert.ok(colors.includes("#1234565c"));
        assert.ok(colors.includes("#ff8fe0"), "axes keep their theme color");
        engine.setAppearance("paper");
        colors.length = 0;
        flush();
        assert.ok(colors.includes("#12345626"), "custom color persists across appearance changes");
        assert.ok(colors.includes("#555"), "Paper axes remain unchanged");
        engine.setGridColor(null);
        colors.length = 0;
        flush();
        assert.ok(colors.includes("rgba(0,0,0,0.09)"), "reset restores Paper theme defaults");
        engine.setAppearance("full");
        colors.length = 0;
        flush();
        assert.ok(colors.includes("rgba(169,140,255,0.15)"));
        assert.equal(engine.getPagePdf(page.id).pdf, pdf, "view settings do not affect output");
        for (const color of ["red", "#123", "#zzzzzz", 12])
            assert.throws(() => engine.setGridColor(color), /Grid color/);
        assert.throws(() => engine.setExtendedZoom("true"), /checkbox/);
        for (const value of [0, -1, Infinity, NaN])
            assert.throws(() => engine.setScale(value), /positive and finite/);
    } finally {
        engine.dispose();
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.ResizeObserver;
        delete globalThis.requestAnimationFrame;
        delete globalThis.cancelAnimationFrame;
    }
});

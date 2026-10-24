import test from "node:test";
import assert from "node:assert/strict";

test("Paper renders all canvas tools in monochrome and switching back restores color without changing data", async () => {
    let frame;
    const colors = new Set();
    const blurs = [];
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
        measureText: text => ({ width: text.length * 7 })
    }, {
        get: (target, key) => target[key] ?? (() => {}),
        set(target, key, value) {
            if (["fillStyle", "strokeStyle", "shadowColor"].includes(key)) colors.add(value);
            if (key === "shadowBlur") blurs.push(value);
            target[key] = value;
            return true;
        }
    });
    const workspace = Object.assign(new EventTarget(), {
        clientWidth: 1024, clientHeight: 768, style: {},
        classList: { toggle() {}, add() {}, remove() {} },
        setPointerCapture() {},
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
        focus() { document.activeElement = workspace; }
    });
    const engine = await import("../wwwroot/cad/engine.js");
    const flush = () => {
        const callback = frame;
        frame = null;
        callback?.();
    };
    const pointer = (type, x, y) => {
        workspace.dispatchEvent(Object.assign(new Event(type), {
            button: 0, clientX: x, clientY: y, detail: 1, pointerId: 1
        }));
        flush();
    };
    const click = (x, y) => {
        pointer("pointerdown", x, y);
        pointer("pointerup", x, y);
    };
    const isMonochrome = color => {
        if (color === "transparent") return true;
        if (color.startsWith("#")) {
            const digits = color.slice(1);
            const rgb = digits.length === 3 ? [...digits].map(v => v + v) : digits.match(/../g);
            return rgb[0] === rgb[1] && rgb[1] === rgb[2];
        }
        const rgb = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        return rgb !== null && rgb[1] === rgb[2] && rgb[2] === rgb[3];
    };
    try {
        engine.init(workspace, { getContext: () => context }, {
            invokeMethodAsync: () => Promise.resolve()
        }, 1000, 1000);
        engine.setAppearance("paper");
        flush();
        engine.setTool("line");
        click(200, 200);
        pointer("pointermove", 500, 200);
        click(500, 200);
        engine.setTool("ruler");
        click(200, 200);
        click(500, 200);
        engine.rulerAddPoints();
        pointer("pointermove", 500, 500);
        click(500, 500);
        engine.rulerStop();
        engine.rulerSave();
        engine.setTool("select");
        click(200, 200);
        engine.startMove();
        click(200, 200);
        engine.confirmMoveBase();
        pointer("pointermove", 250, 250);
        engine.cancelProcess();
        engine.setSelectionMode("lines");
        click(350, 200);
        pointer("pointermove", 350, 200);
        pointer("pointerdown", 100, 100);
        pointer("pointermove", 600, 600);
        pointer("pointerup", 600, 600);
        assert.ok(colors.size >= 8, "exercises ink, labels, shading, grid and selection colors");
        assert.ok([...colors].every(isMonochrome), `non-monochrome canvas color: ${[...colors].filter(c => !isMonochrome(c))}`);
        assert.ok(blurs.every(value => value === 0), "Paper disables canvas glows");

        const data = engine.getDataText();
        for (const appearance of ["full", "performance", "paper"]) {
            colors.clear();
            blurs.length = 0;
            engine.setAppearance(appearance);
            flush();
            assert.equal(engine.getDataText(), data, "appearance changes do not modify project data");
            assert.equal([...colors].every(isMonochrome), appearance === "paper");
            if (appearance !== "full") assert.ok(blurs.every(value => value === 0));
        }
        assert.throws(() => engine.setAppearance("unknown"), /Unknown appearance/);
        colors.clear();
        engine.setTool("cross");
        flush();
        assert.ok([...colors].every(isMonochrome), "invalid appearance leaves Paper unchanged");
    } finally {
        engine.dispose();
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.ResizeObserver;
        delete globalThis.requestAnimationFrame;
        delete globalThis.cancelAnimationFrame;
    }
});

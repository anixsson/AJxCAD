import test from "node:test";
import assert from "node:assert/strict";
import { attach, detach, clampWidth } from "../wwwroot/cad/panel.js";

test("panel width stays within configured and viewport bounds", () => {
    assert.equal(clampWidth(200, 1000), 280);
    assert.equal(clampWidth(900, 1000), 720);
    assert.equal(clampWidth(700, 600), 568);
    assert.equal(clampWidth(360.6, 1000), 361);
});

test("dragging the left edge resizes locally and saves only when finished; detach removes handlers", () => {
    const previous = globalThis.window;
    globalThis.window = { innerWidth: 1200 };
    const saved = [];
    const styles = [];
    const panel = Object.assign(new EventTarget(), {
        style: { setProperty: (...args) => styles.push(args) },
        getBoundingClientRect: () => ({ width: 360 }),
        setPointerCapture() {},
        hasPointerCapture: () => true,
        releasePointerCapture() {}
    });
    const event = (type, x, resize = true) => {
        const e = Object.assign(new Event(type), { button: 0, pointerId: 1, clientX: x });
        Object.defineProperty(e, "target", { value: { classList: { contains: () => resize } } });
        panel.dispatchEvent(e);
    };
    try {
        attach(panel, { invokeMethodAsync: (...args) => { saved.push(args); return Promise.resolve(); } });
        event("pointerdown", 800, false);
        event("pointermove", 700);
        assert.equal(styles.length, 0, "ordinary controls do not resize the panel");
        event("pointerdown", 800);
        event("pointermove", 700);
        assert.deepEqual(styles.at(-1), ["--panel-width", "460px"]);
        assert.deepEqual(saved, []);
        event("pointerup", 700);
        assert.deepEqual(saved, [["SaveWidth", 460]]);
        detach(panel);
        event("pointerdown", 800);
        event("pointerup", 600);
        assert.equal(saved.length, 1);
    } finally {
        detach(panel);
        globalThis.window = previous;
    }
});

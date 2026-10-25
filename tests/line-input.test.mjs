import test from "node:test";
import assert from "node:assert/strict";
import { bucket, clearAll } from "../wwwroot/cad/store.js";
import { normalizeLayers } from "../wwwroot/cad/layers.js";

test("cursor length input handles typing, Enter, validation, units, focus and cancellation", async () => {
    clearAll();
    normalizeLayers();
    const element = extra => Object.assign(new EventTarget(), {
        style: {}, value: "", textContent: "", attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        removeAttribute(name) { delete this.attributes[name]; },
        focus() { document.activeElement = this; }
    }, extra);
    const input = element({ tagName: "INPUT" });
    const error = element();
    const box = element({
        hidden: true, offsetWidth: 144, offsetHeight: 38,
        querySelector: selector => selector === "input" ? input : selector === "[role=alert]" ? error : null
    });
    const workspace = element({
        tagName: "DIV", clientWidth: 1024, clientHeight: 768,
        classList: { toggle() {}, add() {}, remove() {} },
        getBoundingClientRect: () => ({ left: 0, top: 0 })
    });
    globalThis.window = Object.assign(new EventTarget(), { devicePixelRatio: 1 });
    globalThis.document = Object.assign(new EventTarget(), {
        hasFocus: () => true, activeElement: workspace,
        querySelector: selector => selector === "[data-line-length]" ? box : null,
        querySelectorAll: () => []
    });
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
    const pointer = (type, x, y) => workspace.dispatchEvent(Object.assign(new Event(type), {
        button: 0, clientX: x, clientY: y, detail: 1, pointerId: 1
    }));
    const key = (target, value, extra = {}) => {
        const event = Object.assign(new Event("keydown", { cancelable: true }), { key: value, ...extra });
        target.dispatchEvent(event);
        return event;
    };
    const engine = await import("../wwwroot/cad/engine.js");
    try {
        engine.init(workspace, { getContext: () => ({}) }, { invokeMethodAsync: () => Promise.resolve() }, 1, 1);
        engine.setImperial(false);
        engine.setSnapOptions(false, false, false);
        engine.setTool("line");
        pointer("pointerdown", 512, 384);
        pointer("pointermove", 542, 344);
        assert.equal(box.hidden, false);
        assert.equal(box.style.left, "560px");
        input.focus();
        input.value = "99";
        engine.setLineDirectAdd(false);
        assert.equal(box.hidden, true);
        assert.equal(input.value, "");
        assert.equal(document.activeElement, workspace);
        assert.equal(key(document, "5").defaultPrevented, false, "typing is not intercepted while disabled");
        engine.setLineDirectAdd(true);
        assert.equal(box.hidden, false);
        assert.equal(input.value, "", "re-enabling clears the old draft");
        assert.equal(key(document, "1").defaultPrevented, true);
        assert.equal(document.activeElement, input);
        assert.equal(input.value, "1");
        input.value = "12.5";
        assert.equal(key(input, "Enter").defaultPrevented, true);
        assert.equal(document.activeElement, workspace);
        const line = bucket("lines").items[0];
        assert.deepEqual([line.x1, line.y1 + 0, line.x2, line.y2], [0, 0, 7.5, 10]);
        assert.equal(input.value, "");
        assert.equal(box.hidden, false, "Multi keeps the field for the next segment");

        for (const value of ["", "0", "-1", "Infinity", "12abc", "1.2.3"]) {
            input.value = value;
            key(input, "Enter");
            assert.match(error.textContent, /positive, finite/);
            assert.equal(input.attributes["aria-invalid"], "true");
            assert.equal(bucket("lines").items.length, 1);
        }
        input.dispatchEvent(new Event("input"));
        assert.equal(error.textContent, "");
        input.value = "10";
        key(input, "Enter");
        assert.match(error.textContent, /direction/);
        assert.equal(bucket("lines").items.length, 1, "no stale direction after placing");

        pointer("pointermove", 519.5, 334);
        input.value = "0,5";
        engine.setImperial(true);
        assert.equal(input.value, "0,5", "unit mode changes preserve the millimetre draft");
        key(input, "Enter");
        const next = bucket("lines").items[1];
        assert.equal(next.x1, 7.5);
        assert.ok(Math.abs(next.y2 - 10.5) < 1e-10, "input stays in millimetres in imperial mode");
        assert.equal(next.x2, 7.5);
        pointer("pointermove", 1020, 765);
        assert.ok(parseFloat(box.style.left) <= 880);
        assert.ok(parseFloat(box.style.top) <= 730);
        key(input, "Escape");
        assert.equal(box.hidden, true);
        assert.equal(document.activeElement, workspace);
        pointer("pointerdown", 600, 300);
        engine.setTool("cross");
        assert.equal(box.hidden, true);
        engine.setLineDirectAdd(false);
        engine.setTool("line");
        pointer("pointerdown", 600, 300);
        pointer("pointermove", 650, 300);
        assert.equal(box.hidden, true, "tool switches preserve Direct add off");
        const before = bucket("lines").items.length;
        pointer("pointerdown", 650, 300);
        assert.equal(bucket("lines").items.length, before + 1, "click placement still works");
    } finally {
        engine.dispose();
        for (const name of ["window", "document", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame"])
            delete globalThis[name];
    }
});

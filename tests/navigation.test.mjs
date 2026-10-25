import test from "node:test";
import assert from "node:assert/strict";
import { getView } from "../wwwroot/cad/project.js";

test("Pan scrolls in both axes without changing content; pinch and other tools still zoom", async () => {
    globalThis.window = Object.assign(new EventTarget(), { devicePixelRatio: 1 });
    globalThis.document = Object.assign(new EventTarget(), {
        hasFocus: () => true, activeElement: { tagName: "BODY" },
        querySelector: () => null, querySelectorAll: () => []
    });
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
    const classes = new Set();
    const workspace = Object.assign(new EventTarget(), {
        clientWidth: 1024, clientHeight: 768, style: {},
        classList: {
            toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
            add: name => classes.add(name),
            remove: name => classes.delete(name)
        },
        getBoundingClientRect: () => ({ left: 0, top: 0 })
    });
    const engine = await import("../wwwroot/cad/engine.js");
    const view = () => {
        engine.getDataText();
        const { cx, cy, zoom } = getView();
        return { cx: cx + 0, cy: cy + 0, zoom };
    };
    const wheel = (deltaX, deltaY, deltaMode = 0, ctrlKey = false) => {
        const event = Object.assign(new Event("wheel", { cancelable: true }), {
            deltaX, deltaY, deltaMode, ctrlKey, clientX: 512, clientY: 384
        });
        workspace.dispatchEvent(event);
        assert.equal(event.defaultPrevented, true);
    };
    engine.init(workspace, { getContext: () => ({}) }, {
        invokeMethodAsync: () => Promise.resolve()
    }, 1000, 1000);
    try {
        assert.deepEqual(view(), { cx: 0, cy: 0, zoom: 1 });
        const content = engine.getContentText();
        wheel(80, 40);
        assert.deepEqual(view(), { cx: 80, cy: -40, zoom: 1 });
        wheel(-80, -40);
        assert.deepEqual(view(), { cx: 0, cy: 0, zoom: 1 }, "reverse scroll restores the view");
        wheel(2, -3, 1);
        assert.deepEqual(view(), { cx: 32, cy: 48, zoom: 1 }, "line scrolling uses CSS pixels");
        wheel(-2, 3, 1);
        wheel(1, -1, 2);
        assert.deepEqual(view(), { cx: 1024, cy: 768, zoom: 1 }, "page scrolling uses workspace dimensions");
        wheel(-1, 1, 2);
        wheel(0, -100, 0, true);
        assert.ok(view().zoom > 1, "pinch/Ctrl-scroll zooms while Pan is active");
        assert.equal(view().cx, 0);
        assert.equal(view().cy, 0);
        const zoom = view().zoom;
        engine.setTool("select");
        assert.ok(classes.has("drawing"), "Select uses the workspace crosshair rather than the hand cursor");
        wheel(0, 100);
        assert.ok(view().zoom < zoom, "ordinary scrolling still zooms in Select");
        assert.equal(engine.getContentText(), content, "navigation never modifies drawing content");
        engine.setTool("cross");
        assert.equal(classes.has("drawing"), false, "Pan restores the hand cursor");
    } finally {
        engine.dispose();
    }
});

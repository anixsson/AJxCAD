import test from "node:test";
import assert from "node:assert/strict";
import { bucket, serialize, deserialize, undo } from "../wwwroot/cad/store.js";
import { PAGES, addPage } from "../wwwroot/cad/pages.js";
import { createPageTool } from "../wwwroot/cad/tools/page.js";
import { componentAt, pageComponentGeometry, drawPageComponents } from "../wwwroot/cad/page-components.js";
import { pagePdf } from "../wwwroot/cad/pdf.js";

const formatLength = mm => `${+mm.toFixed(3)} mm`;
function setup() {
    bucket(PAGES).items = [];
    const page = addPage({ scale: 50, x: 100, y: 200 });
    const tool = createPageTool({
        toWorld: (x, y) => ({ x, y }), toScreen: (x, y) => ({ x, y }),
        snap: (x, y) => ({ x, y }), formatLength, redraw() {}, log() {}
    });
    tool.select(page.id);
    return { tool, page };
}
const click = (tool, x, y) => { tool.pointerDown({ sx: x, sy: y }); tool.pointerUp(); };
const geometry = page => pageComponentGeometry(page, formatLength);

test("compass needs two clicks, stores north in paper coordinates, and stays a draft until saved", () => {
    const { tool, page } = setup();
    tool.startComponent("compass");
    assert.equal(tool.state().componentPlacement, "compass-position");
    click(tool, 10000, 10000);
    assert.equal(tool.state().componentPlacement, "compass-position", "outside clicks cannot place it");
    click(tool, 600, 700);
    assert.equal(tool.state().componentPlacement, "compass-direction");
    assert.equal(tool.state().dirty, false);
    assert.throws(() => tool.save(), /Finish placing/);
    click(tool, 600, 700);
    assert.equal(tool.state().componentPlacement, "compass-direction", "zero direction cannot finish it");
    click(tool, 1600, 700);
    assert.equal(tool.state().componentPlacement, null);
    assert.equal(page.compass, null);
    assert.deepEqual(tool.state().draft.compass, { x: 10, y: 10, size: 100, angle: -Math.PI / 2 });
    tool.save();
    const north = geometry(page).find(m => m.text === "N").at;
    assert.equal(north.x, 1200, "north points right");
    assert.ok(Math.abs(north.y - 700) < 1e-9);
    assert.equal(undo(), true);
    tool.dataChanged();
    assert.equal(tool.state().draft.compass, null);
});

test("ruler places once, moves by replacement, resizes and removes with Save/Cancel", () => {
    const { tool, page } = setup();
    tool.startComponent("ruler");
    click(tool, 100, -800);
    assert.deepEqual(tool.state().draft.ruler, { x: 0, y: -20, size: 100, angle: 0 });
    tool.save();
    tool.startComponent("ruler");
    click(tool, 1100, -800);
    tool.setDraft({ ruler: { ...tool.state().draft.ruler, size: 200 } });
    assert.equal(page.ruler.size, 100);
    tool.cancel();
    assert.equal(tool.state().draft.ruler.size, 100);
    assert.equal(tool.state().draft.ruler.x, 0);
    tool.startComponent("ruler");
    click(tool, 1100, -800);
    tool.save();
    assert.equal(page.ruler.x, 20);
    assert.equal(geometry(page).filter(m => m.text?.startsWith("Scale ")).length, 1);
    tool.setDraft({ ruler: null });
    assert.equal(page.ruler.x, 20);
    tool.save();
    assert.equal(page.ruler, null);
});

test("cancel placement, undo, switching pages and deactivation do not leave partial components", () => {
    const { tool, page } = setup();
    for (const cancel of [() => tool.cancel(), () => tool.undoStep(), () => tool.deactivate()]) {
        tool.select(page.id);
        tool.startComponent("compass");
        click(tool, 0, 0);
        cancel();
        assert.equal(tool.state().componentPlacement, null);
        assert.equal(page.compass, null);
    }
    tool.select(page.id);
    tool.startComponent("ruler");
    tool.select(addPage({ x: 20000 }).id);
    assert.equal(tool.state().componentPlacement, null);
    assert.equal(tool.state().draft.ruler, null);
});

test("component input is validated atomically and draft objects do not alias stored data", () => {
    const { tool, page } = setup();
    assert.throws(() => tool.startComponent("other"), /Unknown page component/);
    const c = { x: 1, y: 2, size: 100, angle: 0 };
    for (const bad of [undefined, [], { ...c, size: 24 }, { ...c, size: 401 }, { ...c, x: NaN }, { ...c, angle: Infinity }]) {
        assert.throws(() => tool.setDraft({ compass: bad }), /finite paper coordinates/);
        assert.equal(tool.state().draft.compass, null);
    }
    tool.setDraft({ compass: c });
    c.size = 300;
    assert.equal(tool.state().draft.compass.size, 100);
    tool.save();
    tool.setDraft({ compass: { ...tool.state().draft.compass, size: 200 } });
    assert.equal(page.compass.size, 100);
    tool.cancel();
    assert.equal(tool.state().draft.compass.size, 100);
});

test("components follow page movement, hiding, deletion, undo and project round-trip", () => {
    const { tool, page } = setup();
    tool.setDraft({ compass: componentAt(page, { x: 600, y: 700 }), ruler: componentAt(page, { x: 100, y: -800 }) });
    tool.save();
    const before = geometry(page).find(m => m.text === "N").at;
    click(tool, 100, 200);
    tool.pointerDown({ sx: 100, sy: 200 });
    tool.pointerMove({ sx: 300, sy: 500 });
    tool.pointerUp();
    const after = geometry(page).find(m => m.text === "N").at;
    assert.deepEqual(after, { x: before.x + 200, y: before.y + 300 });
    const saved = serialize();
    deserialize(saved);
    tool.dataChanged();
    assert.deepEqual(bucket(PAGES).items[0].compass, page.compass);
    assert.deepEqual(bucket(PAGES).items[0].ruler, page.ruler);
    tool.startComponent("compass");
    tool.setVisible(page.id, false);
    assert.equal(tool.state().componentPlacement, null);
    assert.deepEqual(geometry(bucket(PAGES).items[0]), []);
    assert.throws(() => tool.startComponent("ruler"), /visible, selectable/);
    tool.setVisible(page.id, true);
    tool.setLocked(page.id, true);
    assert.throws(() => tool.startComponent("compass"), /visible, selectable/);
    assert.ok(geometry(bucket(PAGES).items[0]).length, "No select does not hide components");
    tool.deletePage(page.id);
    assert.equal(bucket(PAGES).items.length, 0);
    undo();
    tool.dataChanged();
    assert.deepEqual(bucket(PAGES).items[0].ruler, page.ruler);
});

test("older pages default to no components and saving adds compatible fields", () => {
    const { tool, page } = setup();
    delete page.compass;
    delete page.ruler;
    tool.dataChanged();
    assert.equal(tool.state().draft.compass, null);
    assert.equal(tool.state().draft.ruler, null);
    assert.deepEqual(geometry(page), []);
    tool.setDraft({ name: "Old page" });
    tool.save();
    assert.equal(page.compass, null);
    assert.equal(page.ruler, null);
});

test("ruler distance and physical bar agree at every page scale and component size", () => {
    const { page } = setup();
    for (const scale of [0.01, 0.5, 1, 50, 100000]) {
        for (const size of [25, 100, 200, 400]) {
            page.scale = scale;
            page.ruler = { x: 0, y: 0, size, angle: 0 };
            const marks = geometry(page);
            const labels = marks.filter(m => m.text !== undefined);
            const first = marks[0].points[0], last = marks[3].points[1];
            assert.ok(Math.abs((last.x - first.x) - Number.parseFloat(labels[1].text)) < 1e-6);
            assert.ok((last.x - first.x) / scale <= 40 * size / 100 + 1e-9);
            assert.equal(labels[2].size, 3 * size / 100, "ruler text scales too");
        }
    }
    page.scale = 50;
    page.ruler.size = 100;
    const marks = geometry(page);
    assert.equal(marks.find(m => m.text === "2000 mm").text, "2000 mm");
    assert.equal(marks.find(m => m.text === "Scale 1:50").text, "Scale 1:50");
    assert.equal((marks[3].points[1].x - marks[0].points[0].x) / page.scale, 40,
        "a 2 m bar prints 40 mm at 1:50, so a 1 m line prints 20 mm");
    page.ruler.size = 200;
    const doubled = geometry(page);
    assert.equal(doubled[3].points[1].x - doubled[0].points[0].x,
        2 * (marks[3].points[1].x - marks[0].points[0].x), "resizing doubles the entire bar");
    assert.ok(doubled.some(m => m.text === "4000 mm"), "labels retain the true distance after resizing");
});

test("each page owns its components and new pages do not inherit them", () => {
    const { tool, page } = setup();
    tool.setDraft({ ruler: { x: 0, y: 0, size: 100, angle: 0 } });
    tool.save();
    tool.startPlacing();
    click(tool, 20000, 0);
    const second = bucket(PAGES).items[1];
    assert.equal(second.ruler, null);
    tool.setDraft({ compass: { x: 0, y: 0, size: 100, angle: 0 } });
    tool.save();
    tool.deletePage(second.id);
    assert.equal(bucket(PAGES).items[0], page);
    assert.ok(page.ruler);
    assert.equal(page.compass, null);
});

test("canvas clips each page and uses the shared geometry for screen and paper views", () => {
    const { page } = setup();
    page.ruler = { x: 100, y: 140, size: 200, angle: 0 };
    page.compass = { x: 0, y: 0, size: 100, angle: 0 };
    for (const paper of [false, true]) {
        const calls = [];
        const g = new Proxy({}, {
            get: (_, key) => (...args) => calls.push([key, ...args]),
            set: (_, key, value) => { calls.push([key, value]); return true; }
        });
        const view = { dpr: 2, paper, toScreen: (x, y) => ({ x, y: -y }) };
        drawPageComponents(g, page, view, formatLength);
        assert.equal(calls.filter(c => c[0] === "clip").length, 1);
        assert.deepEqual(calls.filter(c => c[0] === "fillText").map(c => c[1]), ["N", "0", "4000 mm", "Scale 1:50"]);
        assert.ok(calls.some(c => c[0] === "fillStyle" && c[1] === (paper ? "#000" : "#96ffbe")));
        assert.equal(calls.at(-1)[0], "restore");
    }
});

test("vector PDF includes components with correct paper sizing, units and visibility", () => {
    const { page } = setup();
    page.compass = { x: 0, y: 0, size: 200, angle: -Math.PI / 2 };
    page.ruler = { x: 0, y: -50, size: 100, angle: 0 };
    const format = { length: mm => `${mm / 1000} m` };
    const pdf = pagePdf(page, [], [], format);
    assert.match(pdf, /\(N\) Tj/);
    assert.match(pdf, /\(2 m\) Tj/);
    assert.match(pdf, /\(Scale 1:50\) Tj/);
    assert.match(pdf, /\/F1 19\.843 Tf/, "compass text is 7 mm on paper at 200%");
    assert.match(pdf, /q 0 0 595\.276 841\.89 re W n/, "clipped to sheet");
    assert.equal(pagePdf({ ...page, textSize: 400 }, [], [], format), pdf, "measurement text size does not resize components");
    const hidden = pagePdf({ ...page, visible: 0 }, [], [], format);
    assert.doesNotMatch(hidden, /\(N\) Tj|\(2 m\) Tj|\(Scale/);
    const imperial = pagePdf(page, [], [], { length: mm => `${+(mm / 25.4).toFixed(3)} in` });
    assert.match(imperial, /\(78\.74 in\) Tj/);
});

test("engine pointer events place components, render with other tools and export saved page data", async () => {
    bucket(PAGES).items = [];
    const frames = new Map(), labels = [], calls = [];
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
        measureText: text => ({ width: text.length * 7 }),
        fillText: text => labels.push(text)
    }, { get: (target, key) => target[key] ?? (() => {}) });
    const workspace = Object.assign(new EventTarget(), {
        clientWidth: 1024, clientHeight: 768, style: {},
        classList: { toggle() {}, add() {}, remove() {} },
        setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }),
        focus() { document.activeElement = workspace; }
    });
    const flush = () => {
        labels.length = 0;
        for (let i = 0; frames.size && i < 10; i++) {
            const batch = [...frames.values()];
            frames.clear();
            for (const callback of batch) callback(performance.now() + 1000);
        }
        assert.equal(frames.size, 0);
    };
    const engine = await import("../wwwroot/cad/engine.js");
    engine.init(workspace, { getContext: () => context }, {
        invokeMethodAsync: (name, ...args) => { calls.push({ name, args }); return Promise.resolve(); }
    }, 1000, 1000);
    const pointerClick = (x, y) => {
        for (const type of ["pointerdown", "pointerup"]) workspace.dispatchEvent(Object.assign(new Event(type), {
            button: 0, clientX: x, clientY: y, detail: 1, pointerId: 1
        }));
        flush();
    };
    try {
        flush();
        const page = addPage({ scale: 10 });
        engine.selectPage(page.id);
        engine.startPageComponent("compass");
        pointerClick(512, 384);
        pointerClick(612, 384);
        assert.equal(page.compass, null);
        assert.equal(engine.getPages().draft.compass.angle, -Math.PI / 2);
        engine.startPageComponent("ruler");
        pointerClick(512, 484);
        engine.savePage();
        flush();
        assert.ok(labels.includes("N"));
        assert.ok(labels.includes("Scale 1:10"));
        assert.equal(calls.findLast(c => c.name === "OnPagesChanged").args[0].dirty, false);
        engine.setPagePreview(true);
        flush();
        assert.ok(labels.includes("Scale 1:10"));
        engine.setTool("select");
        flush();
        assert.ok(labels.includes("N"), "components render with other tools");
        assert.match(engine.getPagePdf(page.id).pdf, /\(Scale 1:10\) Tj/);
        engine.setPageVisible(page.id, false);
        flush();
        assert.ok(!labels.includes("N"));
        assert.ok(!labels.includes("Scale 1:10"));
        engine.setPageVisible(page.id, true);
        flush();
        assert.ok(labels.includes("N"));
        engine.deletePage(page.id);
        flush();
        assert.ok(!labels.includes("N"));
        engine.undo();
        flush();
        assert.ok(labels.includes("N"), "undo restores page and components together");
    } finally {
        engine.dispose();
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.ResizeObserver;
        delete globalThis.requestAnimationFrame;
        delete globalThis.cancelAnimationFrame;
    }
});

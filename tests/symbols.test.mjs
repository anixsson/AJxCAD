import test from "node:test";
import assert from "node:assert/strict";
import { bucket, clearAll, serialize, deserialize, undo } from "../wwwroot/cad/store.js";
import { normalizeLayers, activeLayerId, updateLayer, visibleItems } from "../wwwroot/cad/layers.js";
import { addLine } from "../wwwroot/cad/lines.js";
import { addText, createTextTool } from "../wwwroot/cad/text.js";
import { SYMBOLS, parseSymbolSource, prepareSymbolSource, addSymbol, setSymbolScale, refreshSymbol,
    symbolSourceState, symbolBounds, clearSymbolSources, symbolGeometry, createSymbolTool } from "../wwwroot/cad/symbols.js";
import { createSelectTool } from "../wwwroot/cad/tools/select.js";
import { pagePdf } from "../wwwroot/cad/pdf.js";

const data = entries => JSON.stringify({ app: "ajxcad", format: 1, buckets: Object.entries(entries).map(([name, items]) => {
    const fields = [...new Set(items.flatMap(Object.keys))];
    return { name, fields, rows: items.map(item => fields.map(f => item[f])) };
}) });
const sourceText = () => data({
    project: [{ id: 1, name: "Source only", pointVisibility: "off" }],
    layers: [{ id: 10, visible: true, printable: false }, { id: 11, visible: false }],
    lines: [{ id: 2, x1: 50, y1: 20, x2: 150, y2: 70, layerId: 10 },
        { id: 3, x1: 9000, y1: 9000, x2: 10000, y2: 10000, layerId: 11 }],
    pages: [{ id: 4, x: 100000, y: 100000 }],
    points: [{ id: 5, x: -5000, y: -5000, showMarker: true }]
});
const noRead = async () => { throw new Error("Unexpected source read"); };
function reset() { clearAll(); normalizeLayers(); clearSymbolSources(); }
const context = () => {
    const calls = [];
    const g = new Proxy({ measureText: text => ({ width: text.length * 7 }) },
        { get: (target, key) => target[key] ?? ((...args) => calls.push([key, ...args])) });
    return { g, calls };
};
const view = extra => ({
    dpr: 1, scale: 1, width: 2000, height: 2000, paper: false, fx: false,
    toScreen: (x, y) => ({ x, y: 1000 - y }), ...extra
});

test("source tool buckets are isolated, including hidden items, with independent layer visibility", () => {
    reset(); addLine(1, 2, 3, 4);
    const before = serialize(), source = parseSymbolSource(sourceText());
    assert.equal(source.buckets.get("lines").length, 2, "all source items load, including hidden layers");
    assert.equal(source.items("lines").length, 1);
    assert.equal(source.items("lines")[0].layerId, 10, "source Print flag does not hide visible content");
    for (const name of ["project", "pages", "layers"]) assert.equal(source.buckets.has(name), false);
    assert.equal(source.settings.visibility, "off");
    assert.equal(serialize(), before);
    assert.equal(parseSymbolSource(data({ lines: [{ x1: 0, y1: 0, x2: 1, y2: 1 }] })).items("lines").length, 1);
    assert.throws(() => parseSymbolSource(data({ lines: [{ layerId: 999 }] })), /Unknown source layer/);
    assert.throws(() => parseSymbolSource('{"app":"other","buckets":[]}'), /Not an AJxCAD/);
    assert.throws(() => parseSymbolSource(data({ lines: [{ x1: "bad", y1: 0, x2: 1, y2: 1 }] })), /Invalid source geometry/);
    assert.throws(() => parseSymbolSource(data({ measures: [{ points: null }] })), /Invalid source measurement/);
});

test("rendering uses source geometry at its original coordinates relative to the group origin, not a bitmap", async () => {
    reset();
    await prepareSymbolSource("/source.ajx", sourceText(), noRead);
    const item = addSymbol("/source.ajx", 200, 300);
    setSymbolScale(item.id, 2);
    const { g, calls } = context();
    symbolGeometry.draw(g, [item], view());
    assert.ok(calls.some(c => c[0] === "moveTo" && c[1] === 300 && c[2] === 660));
    assert.ok(calls.some(c => c[0] === "lineTo" && c[1] === 500 && c[2] === 560));
    assert.ok(!calls.some(c => ["drawImage", "fillRect"].includes(c[0])), "no image or opaque image background");
    assert.equal(bucket("lines").items.length, 0);
    assert.deepEqual(symbolBounds(item), { left: 300, right: 500, bottom: 340, top: 440 });
    assert.deepEqual(symbolGeometry.points(item), [{ key: "origin", x: 200, y: 300 }]);
});

test("the host Symbols bucket persists only a reference and transform, never source geometry or images", async () => {
    reset();
    await prepareSymbolSource("/source.ajx", sourceText(), noRead);
    const item = addSymbol("/source.ajx", 10, 20);
    setSymbolScale(item.id, 3);
    const saved = serialize(), doc = JSON.parse(saved), b = doc.buckets.find(b => b.name === SYMBOLS);
    assert.deepEqual(b.fields, ["id", "source", "x", "y", "scale", "layerId"]);
    assert.deepEqual(b.rows[0], [item.id, "/source.ajx", 10, 20, 3, activeLayerId()]);
    assert.ok(!saved.includes("Source only") && !saved.includes("image"));
    assert.equal(doc.buckets.find(b => b.name === "lines").rows.length, 0);
    deserialize(saved);
    clearSymbolSources();
    assert.match(symbolSourceState(bucket(SYMBOLS).items[0]).error, /not been loaded/);
    await refreshSymbol(item.id, async () => ({ text: sourceText() }));
    assert.equal(symbolSourceState(item).source.items("lines").length, 1);
    undo(); // deserialize
    undo(); // scale
    assert.equal(bucket(SYMBOLS).items[0].scale, 1);
    undo(); // placement
    assert.equal(bucket(SYMBOLS).items.length, 0);
});

test("source text, shapes, points and measurements use source settings, not host drafts", async () => {
    reset();
    const host = addText("Host", 0, 0), editor = createTextTool({ redraw() {}, textChanged() {} });
    editor.open(host.id);
    editor.setDraft({ text: "Host draft", fontSize: 10, fontFamily: "sans-serif", bold: false, italic: false, underline: false });
    const text = data({
        texts: [{ id: host.id, text: "Source text", x: 20, y: 20, fontSize: 10 }],
        shapes: [{ type: "circle", x1: 40, y1: 50, x2: 70, y2: 90 }],
        points: [{ x: 70, y: 80 }],
        measures: [{ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }]
    });
    try {
        await prepareSymbolSource("/source.ajx", text, noRead);
        const item = addSymbol("/source.ajx", 0, 0), { g, calls } = context();
        symbolGeometry.draw(g, [item], view());
        assert.ok(calls.some(c => c[0] === "fillText" && c[1] === "Source text"));
        assert.ok(!calls.some(c => c[0] === "fillText" && c[1] === "Host draft"));
        assert.ok(calls.some(c => c[0] === "arc" && c[3] === 50), "circle rendered as vector path");
        assert.ok(calls.some(c => c[0] === "fillText" && c[1] === "100 mm"));
        assert.ok(calls.filter(c => c[0] === "arc").length > 2, "source points and measurement points render");
        assert.equal(bucket("shapes").items.length, 0);
        assert.equal(bucket("measures").items.length, 0);
    } finally { editor.cancel(); }
});

test("missing sources show a placeholder; recovery, refresh and relinking retain the host transform", async () => {
    reset();
    await prepareSymbolSource("/old.ajx", sourceText(), noRead);
    const item = addSymbol("/old.ajx", 30, 40); setSymbolScale(item.id, 3);
    await assert.rejects(refreshSymbol(item.id, async () => ({ error: "File not found" })), /File not found/);
    assert.equal(symbolSourceState(item).error, "File not found");
    const { g, calls } = context();
    symbolGeometry.draw(g, [item], view());
    assert.ok(calls.some(c => c[0] === "fillText" && c[1] === "Missing symbol import"));
    const before = structuredClone(item);
    await assert.rejects(refreshSymbol(item.id, async () => ({ text: "invalid" }), "/bad.ajx"));
    assert.deepEqual(item, before);
    await refreshSymbol(item.id, async () => ({ text: sourceText() }));
    assert.equal(symbolSourceState(item).error, undefined);
    await refreshSymbol(item.id, noRead, "/new.ajx", sourceText());
    assert.equal(item.source, "/new.ajx");
    assert.equal(item.x, 30); assert.equal(item.y, 40); assert.equal(item.scale, 3);
    undo();
    assert.equal(bucket(SYMBOLS).items[0].source, "/old.ajx");
});

test("nested references load real tool buckets, respect origins and stop circular imports", async () => {
    reset();
    const child = data({ lines: [{ x1: 10, y1: 10, x2: 20, y2: 20 }] });
    const parent = data({ symbols: [{ source: "/child.ajx", x: 50, y: 60, scale: 2 }] });
    const reads = [];
    await prepareSymbolSource("/parent.ajx", parent, async source => { reads.push(source); return { text: child }; });
    const item = addSymbol("/parent.ajx", 100, 200); setSymbolScale(item.id, 3);
    const { g, calls } = context(); symbolGeometry.draw(g, [item], view());
    assert.deepEqual(reads, ["/child.ajx"]);
    assert.ok(calls.some(c => c[0] === "moveTo" && c[1] === 310 && c[2] === 560));
    assert.deepEqual(symbolBounds(item), { left: 310, right: 370, bottom: 440, top: 500 });
    await assert.rejects(prepareSymbolSource("/self.ajx",
        data({ symbols: [{ source: "/self.ajx", x: 0, y: 0, scale: 1 }] }), noRead), /Circular symbol import/);
    await refreshSymbol(item.id, async () => ({ error: "Nested source missing" }), null, parent);
    assert.equal(symbolSourceState({ source: "/child.ajx" }).error, "Nested source missing");
});

test("outdated refreshes cannot overwrite a newer link or resurrect a deleted symbol", async () => {
    reset();
    const item = addSymbol("/old.ajx", 0, 0);
    let finish;
    const slow = refreshSymbol(item.id, () => new Promise(resolve => { finish = resolve; }));
    await refreshSymbol(item.id, noRead, "/new.ajx", sourceText());
    finish({ error: "Old source removed" }); await slow;
    assert.equal(item.source, "/new.ajx"); assert.equal(symbolSourceState(item).error, undefined);
    const deleted = refreshSymbol(item.id, () => new Promise(resolve => { finish = resolve; }));
    bucket(SYMBOLS).items = [];
    finish({ text: sourceText() }); await deleted;
    assert.equal(bucket(SYMBOLS).items.length, 0);
});

const selectEnv = extra => ({
    geometries: [symbolGeometry], toWorld: (x, y) => ({ x, y }), toScreen: (x, y) => ({ x, y }),
    snap: (x, y) => ({ x, y }), scale: () => 1, formatLength: x => `${x} mm`,
    redraw() {}, log() {}, capture() {}, ...extra
});
test("Select exposes only the group origin, not source endpoints, and moves/deletes the whole group", async () => {
    for (const mode of ["nodes", "lines"]) {
        reset();
        await prepareSymbolSource("/source.ajx", sourceText(), noRead);
        const item = addSymbol("/source.ajx", 0, 0);
        let selected;
        const tool = createSelectTool(selectEnv({ symbolSelectionChanged: id => { selected = id; } }));
        tool.setSelectionMode(mode);
        const e = (x, y) => ({ sx: x, sy: y, pointerId: 1, detail: 1 });
        tool.pointerMove(e(60, 40));
        const { g, calls } = context();
        assert.doesNotThrow(() => tool.draw(g, view()), "hovering the single-origin group in Lines mode is safe");
        tool.pointerDown(e(60, 40)); tool.pointerUp(e(60, 40));
        assert.equal(selected, item.id);
        tool.draw(g, view());
        assert.ok(calls.some(c => c[0] === "strokeRect"), "whole group gets a selection outline");
        assert.deepEqual(tool.selectedLayerItems(), [item]);
        assert.equal(symbolGeometry.points(item).length, 1);
        tool.pointerDown(e(60, 40)); tool.pointerMove(e(70, 50)); tool.pointerUp(e(70, 50));
        assert.equal(item.x, 10); assert.equal(item.y, 10);
        assert.equal(symbolSourceState(item).source.items("lines")[0].x1, 50, "source coordinates stay unchanged");
        assert.equal(tool.removeSelectedItems(), 1); assert.equal(selected, null);
        undo(); assert.equal(bucket(SYMBOLS).items.length, 1);
        updateLayer(item.layerId, { visible: false });
        assert.equal(visibleItems(SYMBOLS).length, 0);
    }
});

test("symbol placement anchors source (0,0) to the snapped host position and supports cancellation", async () => {
    reset(); await prepareSymbolSource("/source.ajx", sourceText(), noRead);
    let selected, toolId;
    const tool = createSymbolTool({
        gridSnap: (x, y) => ({ x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10 }),
        setTool: id => { toolId = id; }, selectSymbol: id => { selected = id; }, redraw() {}
    });
    tool.prepare("/source.ajx"); assert.equal(tool.cancel(), true);
    tool.pointerDown({ sx: 13, sy: 24 }); assert.equal(bucket(SYMBOLS).items.length, 0);
    tool.prepare("/source.ajx"); tool.pointerDown({ sx: 13, sy: 24 });
    const item = bucket(SYMBOLS).items[0];
    assert.equal(item.x, 10); assert.equal(item.y, 20);
    assert.equal(selected, item.id); assert.equal(toolId, "select");
    for (const value of [0, -1, NaN, Infinity, 10001]) assert.throws(() => setSymbolScale(item.id, value), /Symbol scale/);
});

test("PDF renders linked tools as vectors, applies group coordinates/scale and host Print flags", async () => {
    reset(); await prepareSymbolSource("/source.ajx", sourceText(), noRead);
    const item = addSymbol("/source.ajx", 0, 0);
    const page = { paper: "A4", landscape: false, scale: 4, x: 0, y: 0 };
    const exportPdf = () => pagePdf(page, [], [], undefined, [], [], [], bucket(SYMBOLS).items);
    let pdf = exportPdf();
    assert.doesNotMatch(pdf, /\/Subtype \/Image|DCTDecode|ASCIIHexDecode/);
    const k = 72 / 25.4 / 4, n = v => `${+v.toFixed(3)}`;
    assert.ok(pdf.includes(`${n((50 + 420) * k)} ${n((20 + 594) * k)} m`));
    setSymbolScale(item.id, 2);
    pdf = exportPdf();
    assert.ok(pdf.includes(`${n((100 + 420) * k)} ${n((40 + 594) * k)} m`));
    const start = Number(pdf.match(/startxref\n(\d+)/)[1]); assert.equal(pdf.slice(start, start + 4), "xref");
    await assert.rejects(refreshSymbol(item.id, async () => ({ error: "Source removed" })));
    assert.match(exportPdf(), /\(Missing symbol import\)/);
    updateLayer(item.layerId, { printable: false });
    assert.doesNotMatch(exportPdf(), /Missing symbol import/);
});

test("nested source tools export as vectors with source text and measurement settings", async () => {
    reset();
    const child = data({
        layers: [{ id: 12345, visible: true, printable: false }],
        texts: [{ id: 1, text: "Nested vector text", x: 10, y: 10, fontSize: 8, layerId: 12345 }],
        shapes: [{ id: 2, type: "circle", x1: 0, y1: 0, x2: 20, y2: 0 }],
        points: [{ id: 3, x: 5, y: 5 }],
        measures: [{ id: 4, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }]
    });
    await prepareSymbolSource("/parent.ajx", data({
        symbols: [{ source: "/child.ajx", x: 10, y: 20, scale: 2 }]
    }), async () => ({ text: child }));
    const item = addSymbol("/parent.ajx", 0, 0);
    const pdf = pagePdf({ paper: "A4", scale: 5, x: 0, y: 0 }, [], [], undefined, [], [], [], [item]);
    assert.match(pdf, /\(Nested vector text\)/);
    assert.match(pdf, /\(100 mm\)/);
    assert.match(pdf, /0\.878 0\.125 0\.125 rg/, "source point marker uses vector colored quadrants");
    assert.match(pdf, / c h/, "source circle uses Bezier geometry");
    assert.doesNotMatch(pdf, /\/Subtype \/Image/);
    assert.match(pdf, /\/F1 14 Tf/, "nested group scale applies to measurement labels without changing their length");
});

test("engine reload uses selected text, sources reload after host open and imported nodes never snap", async () => {
    reset();
    const { g } = context();
    globalThis.window = Object.assign(new EventTarget(), { devicePixelRatio: 1 });
    globalThis.document = Object.assign(new EventTarget(), {
        hasFocus: () => true, activeElement: { tagName: "BODY" },
        querySelector: () => null, querySelectorAll: () => []
    });
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
    const workspace = Object.assign(new EventTarget(), {
        clientWidth: 1000, clientHeight: 700, style: {}, classList: { remove() {}, toggle() {} },
        focus() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }), setPointerCapture() {}
    });
    const engine = await import("../wwwroot/cad/engine.js");
    let reads = 0, text = sourceText();
    engine.init(workspace, { getContext: () => g }, {
        invokeMethodAsync: async name => {
            if (name === "ReadSymbolSource") { reads++; return { text }; }
        }
    }, 1000, 1000);
    try {
        const item = addSymbol("/old.ajx", 0, 0);
        await engine.reloadSymbol(item.id, "/selected.ajx", text);
        assert.equal(reads, 0);
        const saved = engine.getDataText();
        engine.loadDataText(saved);
        assert.match(symbolSourceState(item).error, /not been loaded/);
        await engine.refreshSymbols(); assert.equal(reads, 1);
        // The imported endpoint is (50,20). At zoom 1 a click near it must use grid (40,20), not source endpoint.
        engine.setTool("point");
        workspace.dispatchEvent(Object.assign(new Event("pointerdown"), {
            button: 0, clientX: 542, clientY: 330, detail: 1, pointerId: 1
        }));
        assert.equal(bucket("points").items[0].x, 40);
        assert.equal(bucket("lines").items.length, 0);
        text = data({ lines: [{ x1: 0, y1: 0, x2: 200, y2: 0 }] });
        await engine.refreshSymbols();
        assert.equal(symbolSourceState(item).source.items("lines")[0].x2, 200);
    } finally {
        engine.dispose();
        for (const key of ["window", "document", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame"]) delete globalThis[key];
    }
});

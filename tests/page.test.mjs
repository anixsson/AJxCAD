import test from "node:test";
import assert from "node:assert/strict";
import { bucket, serialize, deserialize, undo } from "../wwwroot/cad/store.js";
import { PAGES, PAPERS, addPage, pageRect, paperSize, scaleLabel, nextPageName } from "../wwwroot/cad/pages.js";
import { createPageTool } from "../wwwroot/cad/tools/page.js";

// Screen = world (1 px per mm, y not flipped) and a grid of 10 keep the numbers readable.
function setup(pages = [], view = { w: 1000, h: 800 }) {
    bucket(PAGES).items = [];
    for (const page of pages) addPage(page);
    const states = [];
    const tool = createPageTool({
        toWorld: (sx, sy) => ({ x: sx, y: sy }),
        toScreen: (x, y) => ({ x, y }),
        snap: (sx, sy) => ({ x: Math.round(sx / 10) * 10, y: Math.round(sy / 10) * 10, kind: "grid" }),
        formatLength: mm => `${+mm.toFixed(3)} mm`,
        viewSizeMm: () => view,
        pagesChanged: s => states.push(s),
        redraw() {},
        log() {}
    });
    return { tool, states, last: () => states.at(-1), items: () => bucket(PAGES).items };
}

test("paper sizes cover ISO A and US sizes in millimetres", () => {
    const ids = PAPERS.map(p => p.id);
    for (const id of ["A4", "A3", "A2", "A1", "A0", "Letter", "Legal", "Tabloid"]) assert.ok(ids.includes(id), id);
    assert.deepEqual(paperSize({ paper: "A4", landscape: 0 }), { w: 210, h: 297 });
    assert.deepEqual(paperSize({ paper: "A3", landscape: 1 }), { w: 420, h: 297 });
    assert.deepEqual(paperSize({ paper: "Letter", landscape: 0 }), { w: 215.9, h: 279.4 });
});

test("the frame is paper size times the scale factor, centred on the page position", () => {
    const r = pageRect({ paper: "A4", landscape: 0, scale: 10, x: 100, y: 50 });
    assert.deepEqual(r, { left: 100 - 1050, right: 100 + 1050, bottom: 50 - 1485, top: 50 + 1485, w: 2100, h: 2970 });
    assert.equal(scaleLabel(50), "1:50");
    assert.equal(scaleLabel(1), "1:1");
    assert.equal(scaleLabel(0.5), "2:1");
});

test("Add page places a frame at the snapped click and selects it", () => {
    const { tool, last, items } = setup();
    tool.startPlacing();
    assert.equal(last().placing, true);
    tool.pointerMove({ sx: 12, sy: 18 });
    tool.pointerDown({ sx: 12, sy: 18 });
    assert.equal(items().length, 1);
    const page = items()[0];
    assert.equal(page.name, "Page 1");
    assert.equal(page.paper, "A4");
    assert.equal(page.landscape, 0);
    assert.equal(page.visible, 1);
    assert.deepEqual([page.x, page.y], [10, 20]);
    // A4 at a 1-2-5 scale that covers about half of a 1000 × 800 mm view: 1.2 -> 1
    assert.equal(page.scale, 1);
    const s = last();
    assert.equal(s.placing, false);
    assert.equal(s.selectedId, page.id);
    assert.equal(s.draft.name, "Page 1");
    assert.equal(s.draft.width, "210 mm");
    assert.equal(s.draft.height, "297 mm");
});

test("the first page fits the view; later pages reuse the last page's paper and scale", () => {
    const { tool, items } = setup([], { w: 20000, h: 30000 });
    tool.startPlacing();
    tool.pointerDown({ sx: 0, sy: 0 });
    assert.equal(items()[0].scale, 20); // min(10000/210, 15000/297) = 47.6 -> 20
    tool.setDraft({ paper: "A3", landscape: true, scale: 50 });
    tool.save();
    tool.startPlacing();
    tool.pointerDown({ sx: 5000, sy: 0 });
    const second = items()[1];
    assert.equal(second.name, "Page 2");
    assert.deepEqual([second.paper, second.landscape, second.scale], ["A3", 1, 50]);
});

test("click selects the topmost visible frame, empty space clears the selection", () => {
    const { tool, last, items } = setup([
        { name: "Under", paper: "A4", scale: 1, x: 0, y: 0 },
        { name: "Over", paper: "A4", scale: 1, x: 50, y: 0 }
    ]);
    tool.pointerDown({ sx: 60, sy: 0 });
    tool.pointerUp({});
    assert.equal(last().selectedId, items()[1].id);
    tool.pointerDown({ sx: -100, sy: 0 });
    tool.pointerUp({});
    assert.equal(last().selectedId, items()[0].id);
    tool.pointerDown({ sx: 5000, sy: 5000 });
    assert.equal(last().selectedId, null);
    assert.equal(last().draft, null);
});

test("hidden frames cannot be clicked but can be selected from the panel", () => {
    const { tool, last, items } = setup([{ name: "P", paper: "A4", scale: 1, x: 0, y: 0, visible: 0 }]);
    tool.pointerDown({ sx: 0, sy: 0 });
    assert.equal(last()?.selectedId ?? null, null);
    tool.select(items()[0].id);
    assert.equal(last().selectedId, items()[0].id);
    assert.equal(last().draft.visible, false);
});

test("dragging a frame moves it on the grid in one undo step", () => {
    const { tool, items } = setup([{ name: "P", paper: "A4", scale: 1, x: 0, y: 0 }]);
    tool.pointerDown({ sx: 3, sy: 4 });
    tool.pointerMove({ sx: 24, sy: -3 });
    tool.pointerMove({ sx: 52, sy: 31 });
    tool.pointerUp({});
    assert.deepEqual([items()[0].x, items()[0].y], [50, 30]);
    assert.equal(undo(), true);
    tool.dataChanged();
    assert.deepEqual([items()[0].x, items()[0].y], [0, 0]);
});

test("the draft previews changes; Save stores them and Cancel restores the page", () => {
    const { tool, last, items } = setup([{ name: "P", paper: "A4", scale: 1, x: 0, y: 0 }]);
    const id = items()[0].id;
    tool.select(id);
    const revision = last().draft.revision;
    tool.setDraft({ name: "Plan", paper: "A3", scale: 50 });
    assert.equal(last().dirty, true);
    assert.equal(last().draft.revision, revision, "typing does not reload the inputs");
    assert.equal(last().draft.scaleLabel, "1:50");
    assert.equal(last().draft.width, "14850 mm");
    assert.equal(items()[0].paper, "A4", "stored page is unchanged until Save");
    assert.equal(tool.rectOf(id).w, 297 * 50, "the board previews the draft");

    assert.equal(tool.cancel(), true);
    assert.equal(last().dirty, false);
    assert.equal(last().draft.name, "P");
    assert.ok(last().draft.revision > revision);

    tool.setDraft({ name: "  Plan  ", landscape: true, scale: 20 });
    tool.save();
    assert.deepEqual({ ...items()[0] }, { id, name: "Plan", paper: "A4", landscape: 1, scale: 20, x: 0, y: 0, visible: 1, locked: 0, textSize: 100 });
    assert.equal(last().dirty, false);
    assert.equal(last().pages[0].summary, "A4 landscape · 1:20");

    assert.equal(undo(), true);
    tool.dataChanged();
    assert.equal(items()[0].name, "P");
    assert.equal(last().draft.name, "P");
});

test("invalid drafts are rejected without changing the draft", () => {
    const { tool, last, items } = setup([{ name: "P", paper: "A4", scale: 1, x: 0, y: 0 }]);
    tool.select(items()[0].id);
    assert.throws(() => tool.setDraft({ scale: 0 }), /Scale must be/);
    assert.throws(() => tool.setDraft({ scale: Number.NaN }), /Scale must be/);
    assert.throws(() => tool.setDraft({ paper: "B5" }), /Unknown paper size/);
    assert.throws(() => tool.setDraft({ x: 5 }), /Unknown page setting/);
    assert.throws(() => tool.setDraft({ name: "x".repeat(61) }), /at most 60/);
    assert.equal(last().draft.scale, 1);
    tool.setDraft({ name: "   " });
    assert.throws(() => tool.save(), /name/);
    assert.equal(items()[0].name, "P");
});

test("visibility checkboxes and delete are undoable", () => {
    const { tool, last, items } = setup([
        { name: "A", paper: "A4", scale: 1, x: 0, y: 0 },
        { name: "B", paper: "A4", scale: 1, x: 500, y: 0 }
    ]);
    const [a, b] = items().map(p => p.id);
    tool.setVisible(a, false);
    assert.equal(items()[0].visible, 0);
    assert.equal(last().pages[0].visible, false);
    tool.select(b);
    tool.deletePage(b);
    assert.deepEqual(items().map(p => p.name), ["A"]);
    assert.equal(last().selectedId, null);
    undo();
    tool.dataChanged();
    assert.deepEqual(items().map(p => p.name), ["A", "B"]);
    undo();
    tool.dataChanged();
    assert.equal(items()[0].visible, 1);
});

test("Esc steps back: placing, then unsaved edits, then the selection", () => {
    const { tool, last, items } = setup([{ name: "P", paper: "A4", scale: 1, x: 0, y: 0 }]);
    tool.startPlacing();
    assert.equal(tool.cancel(), true);
    assert.equal(last().placing, false);
    tool.select(items()[0].id);
    tool.setDraft({ scale: 5 });
    assert.equal(tool.undoStep(), true, "undo drops the unsaved edit first");
    assert.equal(last().draft.scale, 1);
    assert.equal(tool.cancel(), true);
    assert.equal(last().selectedId, null);
    assert.equal(tool.cancel(), false);
});

test("page names fill the lowest free number", () => {
    setup([{ name: "Page 1" }, { name: "Page 3" }]);
    assert.equal(nextPageName(), "Page 2");
});

test("pages are saved and loaded with the project", () => {
    setup([{ name: "Sheet", paper: "Tabloid", landscape: 1, scale: 25, x: 12.5, y: -40, visible: 0, locked: 1, textSize: 150 }]);
    const text = serialize();
    const doc = JSON.parse(text);
    const entry = doc.buckets.find(b => b.name === PAGES);
    assert.deepEqual(entry.fields, ["id", "name", "paper", "landscape", "scale", "x", "y", "visible", "locked", "textSize"]);
    bucket(PAGES).items = [];
    deserialize(text);
    const [page] = bucket(PAGES).items;
    assert.deepEqual({ ...page, id: 0 }, { id: 0, name: "Sheet", paper: "Tabloid", landscape: 1, scale: 25, x: 12.5, y: -40, visible: 0, locked: 1, textSize: 150 });
});

test("No select pages cannot be clicked or dragged on the board but stay editable from the panel", () => {
    const { tool, last, items } = setup([
        { name: "Under", paper: "A4", scale: 1, x: 0, y: 0 },
        { name: "Locked", paper: "A4", scale: 1, x: 50, y: 0 }
    ]);
    const [under, locked] = items().map(p => p.id);
    tool.setLocked(locked, true);
    assert.equal(items()[1].locked, 1);
    assert.equal(last().pages[1].locked, true);

    tool.pointerDown({ sx: 60, sy: 0 });
    tool.pointerUp({});
    assert.equal(last().selectedId, under, "the click goes through to the page underneath");
    tool.pointerDown({ sx: 200, sy: 0 });
    assert.equal(last().selectedId, null, "only the locked page is there");

    tool.select(locked);
    assert.equal(last().draft.locked, true);
    tool.pointerDown({ sx: 200, sy: 0 });
    tool.pointerMove({ sx: 300, sy: 0 });
    tool.pointerUp({});
    assert.equal(items()[1].x, 50, "a locked frame does not move");

    undo();
    tool.dataChanged();
    assert.equal(items()[1].locked, 0);
});

test("pages from older files without the locked field are selectable", () => {
    const { tool, last } = setup();
    bucket(PAGES).items.push({ id: 900, name: "Old", paper: "A4", landscape: 0, scale: 1, x: 0, y: 0, visible: 1 });
    tool.pointerDown({ sx: 0, sy: 0 });
    assert.equal(last().selectedId, 900);
    assert.equal(last().pages[0].locked, false);
});

test("text size is part of the draft, saved per page, and older pages default to 100%", () => {
    const { tool, last, items } = setup([{ name: "P", paper: "A4", scale: 10, x: 0, y: 0 }]);
    delete items()[0].textSize; // a page from an older file
    const id = items()[0].id;
    tool.select(id);
    assert.equal(last().draft.textSize, 100);
    assert.equal(last().dirty, false, "a missing value is not an unsaved change");

    tool.setDraft({ textSize: 250 });
    assert.equal(last().dirty, true);
    assert.equal(items()[0].textSize, undefined, "stored page is unchanged until Save");
    assert.throws(() => tool.setDraft({ textSize: 20 }), /Text size/);
    assert.throws(() => tool.setDraft({ textSize: 1000 }), /Text size/);
    tool.save();
    assert.equal(items()[0].textSize, 250);
    assert.equal(undo(), true);
    assert.equal(items()[0].textSize, undefined);
});

test("print preview follows the selected page's draft and ends when the selection does", () => {
    const { tool, last, items } = setup([{ name: "P", paper: "A4", scale: 10, x: 0, y: 0 }]);
    assert.throws(() => tool.setPreview(true), /Select a page/);
    const id = items()[0].id;
    tool.select(id);
    assert.equal(last().preview, false);
    assert.equal(tool.previewPage(), null);

    tool.setPreview(true);
    assert.equal(last().preview, true);
    tool.setDraft({ scale: 50, textSize: 200 });
    assert.equal(tool.previewPage().scale, 50, "the unsaved draft is previewed live");
    assert.equal(tool.previewPage().textSize, 200);

    tool.setPreview(false);
    assert.equal(tool.previewPage(), null);
    tool.setPreview(true);
    tool.select(null);
    assert.equal(last().preview, false);
    tool.select(id);
    assert.equal(last().preview, false, "a new selection starts without preview");
});

test("edgeAt finds a page by its border or label, not its inside, and grab selects and drags it", () => {
    // A4 at 1:1 centred on (200, 300): x 95..305, y 151.5..448.5
    const { tool, last, items } = setup([{ name: "P", paper: "A4", scale: 1, x: 200, y: 300 }, { name: "Off", x: 900, y: 300, locked: 1 }]);
    const id = items()[0].id;
    assert.equal(tool.edgeAt(97, 300), id);
    assert.equal(tool.edgeAt(200, 447), id);
    assert.equal(tool.edgeAt(200, 300), null);
    assert.equal(tool.edgeAt(60, 300), null);
    assert.equal(tool.edgeAt(900 - 105, 300), null, "No select pages are skipped");

    const g = { set font(v) {}, set textBaseline(v) {}, set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {},
        set shadowColor(v) {}, set shadowBlur(v) {}, setLineDash() {}, fillRect() {}, strokeRect() {}, fillText() {},
        measureText: t => ({ width: t.length * 6 }) };
    tool.drawSaved(g, { dpr: 1, paper: false, width: 2000, height: 2000, toScreen: (x, y) => ({ x, y: 600 - y }) });
    // The label sits above the frame's top-left corner as drawn (screen y = 600 - 448.5).
    assert.equal(tool.edgeAt(120, 600 - 448.5 - 10), id);

    tool.grab(id, { sx: 97, sy: 300 });
    assert.equal(last().selectedId, id);
    tool.pointerMove({ sx: 127, sy: 300 });
    tool.pointerUp({});
    assert.equal(items()[0].x, 230);
});

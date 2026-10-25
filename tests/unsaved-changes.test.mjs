import test from "node:test";
import assert from "node:assert/strict";
import { bucket, checkpoint, clearAll, defineBucket, deserialize, serialize, serializeContent, undo } from "../wwwroot/cad/store.js";
import { getProject, setView, updateProject } from "../wwwroot/cad/project.js";

test("save comparison ignores navigation but detects project settings, drawing edits and undo", () => {
    getProject();
    const lines = defineBucket("lines", { fields: ["id", "x1", "y1", "x2", "y2"] });
    const clean = serializeContent();
    const saved = serialize();

    setView(123, -456, 2);
    assert.equal(serializeContent(), clean, "panning and zooming alone should not prompt");
    assert.notEqual(serialize(), saved, "the saved file must still include the current view");

    updateProject({ name: "Renamed" });
    assert.notEqual(serializeContent(), clean, "title changes require saving");
    updateProject({ name: "Untitled" });
    assert.equal(serializeContent(), clean);

    for (const [field, value] of [["imperial", 1], ["unitMm", 25.4], ["pointScale", 200], ["pointVisibility", "all"]]) {
        const previous = getProject()[field];
        updateProject({ [field]: value });
        assert.notEqual(serializeContent(), clean, `${field} changes require saving`);
        updateProject({ [field]: previous });
        assert.equal(serializeContent(), clean);
    }

    checkpoint();
    lines.items.push({ id: 100, x1: 0, y1: 0, x2: 100, y2: 100 });
    assert.notEqual(serializeContent(), clean, "new geometry requires saving");
    undo();
    assert.equal(serializeContent(), clean, "undo back to the saved state should not prompt");
});

test("saved and loaded baselines detect subsequent edits without changing the file format", () => {
    bucket("lines").items.push({ id: 101, x1: 0, y1: 0, x2: 200, y2: 300 });
    const text = serialize();
    const saved = serializeContent();
    bucket("lines").items[0].x2 = 400;
    assert.notEqual(serializeContent(), saved);
    deserialize(text);
    assert.equal(serializeContent(), saved);
    assert.deepEqual(JSON.parse(serialize()), JSON.parse(text));
});

test("all bucket data, including unknown schemas, participates in save comparison", () => {
    const unknown = bucket("future-tool");
    unknown.items = [{ id: 200, viewX: 5, custom: "preserved" }];
    const saved = serializeContent();
    unknown.items[0].viewX = 6;
    assert.notEqual(serializeContent(), saved, "only the project bucket's view fields are ignored");
    unknown.items[0].viewX = 5;
    assert.equal(serializeContent(), saved);
    unknown.items[0].custom = "edited";
    assert.notEqual(serializeContent(), saved);
});

test("unsaved tool buckets are detected before New would clear them", () => {
    clearAll();
    getProject();
    for (const name of ["lines", "shapes", "text", "points", "measures", "symbols", "pages", "layers"])
        defineBucket(name, { fields: ["id", "value"] });
    const clean = serializeContent();

    for (const name of ["lines", "shapes", "text", "points", "measures", "symbols", "pages", "layers"]) {
        bucket(name).items.push({ id: 300, value: `unsaved ${name}` });
        assert.notEqual(serializeContent(), clean, `New must prompt for unsaved ${name}`);
        const beforeConfirmation = serialize();
        serializeContent();
        assert.equal(serialize(), beforeConfirmation, "checking for unsaved data must not clear any bucket");
        bucket(name).items = [];
        assert.equal(serializeContent(), clean);
    }

    bucket("points").items.push({ id: 301, value: "saved point" });
    const saved = serializeContent();
    clearAll();
    assert.notEqual(serializeContent(), saved, "clearing saved data is also an unsaved change");
    assert.equal(bucket("points").items.length, 0);
});

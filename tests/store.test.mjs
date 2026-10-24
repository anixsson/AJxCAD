import test from "node:test";
import assert from "node:assert/strict";
import { bucket, defineBucket, describe, describePage, serialize, deserialize } from "../wwwroot/cad/store.js";

test("opening the bucket list does not serialize any of 100,000 rows", () => {
    let reads = 0;
    const b = defineBucket("large", { label: "Large", fields: ["id", "x"] });
    b.items = Array.from({ length: 100000 }, (_, id) => ({
        id,
        get x() { reads++; return id + 0.123456789; }
    }));

    const info = describe().find(entry => entry.name === "large");
    assert.deepEqual(info, { name: "large", label: "Large", group: "tool", count: 100000 });
    assert.equal(reads, 0);

    const page = describePage("large", 50000);
    assert.equal(reads, 100);
    assert.deepEqual({ ...page, text: undefined }, {
        offset: 50000, count: 100, total: 100000, pageSize: 100, text: undefined
    });
    const text = JSON.parse(page.text);
    assert.deepEqual(text.fields, ["id", "x"]);
    assert.equal(text.rows.length, 100);
    assert.deepEqual(text.rows[0], [50000, 50000.123457]);
    assert.deepEqual(text.rows.at(-1), [50099, 50099.123457]);
});

test("paging covers every row exactly once and does not change saved data", () => {
    const b = defineBucket("paged", { fields: ["id", "x"] });
    b.items = Array.from({ length: 10001 }, (_, id) => ({ id, x: id / 10 }));
    const saved = serialize();
    const rows = [];
    for (let offset = 0; offset < b.items.length;) {
        const page = describePage("paged", offset);
        assert.ok(page.count > 0 && page.count <= 100);
        assert.equal(page.total, 10001);
        rows.push(...JSON.parse(page.text).rows);
        offset += page.count;
    }
    assert.deepEqual(rows, b.items.map(item => [item.id, item.x]));
    assert.equal(describePage("paged", 10000).count, 1);
    assert.equal(serialize(), saved);
    assert.equal(JSON.parse(saved).buckets.find(entry => entry.name === "paged").rows.length, 10001);

    deserialize(saved);
    assert.deepEqual(bucket("paged").items, rows.map(([id, x]) => ({ id, x })));
});

test("empty and unknown-schema buckets retain their saved text format", () => {
    defineBucket("empty", { fields: ["id", "value"], group: "project" });
    assert.deepEqual(describePage("empty"), {
        offset: 0, count: 0, total: 0, pageSize: 100,
        text: '{"name":"empty","v":1,"fields":["id","value"],"rows":[]}'
    });
    bucket("unknown-schema").items = [{ id: 7, custom: "kept" }];
    assert.deepEqual(JSON.parse(describePage("unknown-schema").text), {
        name: "unknown-schema", v: 1, fields: ["id", "custom"], rows: [[7, "kept"]]
    });
});

test("invalid page requests fail explicitly without creating buckets", () => {
    const before = describe();
    assert.throws(() => describePage("missing"), /Unknown data bucket/);
    assert.deepEqual(describe(), before);
    for (const offset of [-1, 0.5, NaN, Infinity, 10001, Number.MAX_SAFE_INTEGER + 1])
        assert.throws(() => describePage("paged", offset), /offset/);
    assert.throws(() => describePage("empty", 1), /offset/);
});

// Data buckets: every tool family owns exactly one named bucket of plain items (world coordinates in mm),
// so each bucket can be viewed, saved and loaded on its own. Undo works on snapshots of all buckets.
//
// Text format (JSON, one row per line so it stays light and still readable):
//   {"app":"ajxcad","format":1,"buckets":[
//   {"name":"lines","v":1,"fields":["id","x1","y1","x2","y2"],"rows":[
//   [1,0,0,100,50],
//   [2,100,50,100,120]
//   ]}
//   ]}
// A bucket is {name, v, fields, rows}: `fields` names the columns, so columns can be added or reordered
// later and old files still load. Buckets this version does not know are kept as they are.

const FORMAT = 1;
const buckets = new Map();
const history = [];
const migrations = [];
let nextId = 1;

// Registers a bucket. `fields` lists the item properties stored per row, in order.
export function defineBucket(name, { label = name, fields, version = 1, undoable = true, group = "tool" }) {
    const b = bucket(name);
    Object.assign(b, { label, fields, version, undoable, group });
    return b;
}

export function bucket(name) {
    if (!buckets.has(name)) buckets.set(name, { name, label: name, version: 1, fields: null, items: [] });
    return buckets.get(name);
}

export const newId = () => nextId++;
export const registerMigration = migrate => migrations.push(migrate);

// An array limits undo to those fields, leaving the rest of the bucket unchanged.
function snapshot() {
    return [...buckets.values()].filter(b => b.undoable !== false).map(b => ({
        name: b.name,
        items: structuredClone(Array.isArray(b.undoable)
            ? b.items.map(item => Object.fromEntries(b.undoable.map(field => [field, item[field]])))
            : b.items)
    }));
}

// Call right before a change that should be undoable.
export function checkpoint() {
    history.push(snapshot());
    if (history.length > 200) history.shift();
}

export function undo() {
    const previous = history.pop();
    if (!previous) return false;
    for (const b of buckets.values()) if (b.undoable !== false && !Array.isArray(b.undoable)) b.items = [];
    for (const { name, items } of previous) {
        const b = bucket(name);
        if (Array.isArray(b.undoable)) {
            for (let i = 0; i < Math.max(items.length, b.items.length); i++) {
                const item = b.items[i] ?? (b.items[i] = { id: newId() });
                for (const field of b.undoable) {
                    if (items[i]?.[field] === undefined) delete item[field];
                    else item[field] = items[i][field];
                }
            }
        } else b.items = items;
    }
    return true;
}

// Removes everything from every bucket (File > New).
export function clearAll() {
    checkpoint();
    for (const b of buckets.values()) b.items = [];
}

const num = v => (typeof v === "number" ? +v.toFixed(6) : v);

function bucketText(b, items = b.items) {
    const fields = b.fields ?? Object.keys(b.items[0] ?? {});
    const rows = items.map(item => JSON.stringify(fields.map(f => num(item[f]))));
    const head = `{"name":${JSON.stringify(b.name)},"v":${b.version},"fields":${JSON.stringify(fields)},"rows":[`;
    return rows.length ? `${head}\n${rows.join(",\n")}\n]}` : `${head}]}`;
}

// What the data viewer shows: one entry per bucket.
export function describe() {
    return [...buckets.values()].map(b => ({ name: b.name, label: b.label, group: b.group ?? "tool", count: b.items.length }));
}

export function describePage(name, offset = 0) {
    const b = buckets.get(name);
    if (!b) throw new Error(`Unknown data bucket: ${name}`);
    if (!Number.isSafeInteger(offset) || offset < 0 || (offset >= b.items.length && offset !== 0))
        throw new Error("Data bucket page offset is out of range");

    const pageSize = 100;
    const items = b.items.slice(offset, offset + pageSize);
    return { offset, count: items.length, total: b.items.length, pageSize, text: bucketText(b, items) };
}

export function serialize() {
    const parts = [...buckets.values()].map(b => bucketText(b));
    return `{"app":"ajxcad","format":${FORMAT},"buckets":[\n${parts.join(",\n")}\n]}`;
}

// Replaces every bucket with the ones in the text. Returns the number of buckets loaded.
export function deserialize(text) {
    const doc = JSON.parse(text);
    if (doc.app !== "ajxcad" || !Array.isArray(doc.buckets)) throw new Error("Not an AJxCAD data file");
    if (doc.format > FORMAT) throw new Error(`File format ${doc.format} is newer than this version (${FORMAT})`);
    for (const migrate of migrations) migrate(doc);

    checkpoint();
    for (const b of buckets.values()) b.items = [];
    let maxId = 0;
    for (const entry of doc.buckets) {
        const b = bucket(entry.name);
        b.items = entry.rows.map(row => Object.fromEntries(entry.fields.map((f, i) => [f, row[i]])));
        for (const item of b.items) if (typeof item.id === "number") maxId = Math.max(maxId, item.id);
    }
    nextId = Math.max(nextId, maxId + 1);
    return doc.buckets.length;
}

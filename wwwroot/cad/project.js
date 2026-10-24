// The "project" bucket: one row of project-wide data (name, measuring system, 1:1 unit and the saved view).
// The view is the world point at the middle of the screen plus the zoom relative to 1:1, so it still makes
// sense on a different window size or unit. Only point marker settings participate in undo.

import { bucket, defineBucket, newId, registerMigration } from "./store.js";

export const PROJECT = "project";

defineBucket(PROJECT, {
    label: "Project",
    fields: ["id", "name", "imperial", "unitMm", "viewX", "viewY", "viewZoom", "pointScale", "pointVisibility"],
    undoable: ["pointScale", "pointVisibility"], group: "project"
});

const DEFAULTS = { name: "Untitled", imperial: 0, unitMm: 100, viewX: 0, viewY: 0, viewZoom: 1, pointScale: 100, pointVisibility: "local" };

registerMigration(doc => {
    const legacy = doc.buckets.find(b => b.name === "pointSettings");
    if (!legacy) return;
    if (legacy.rows.length) {
        let project = doc.buckets.find(b => b.name === PROJECT);
        if (!project) {
            project = { name: PROJECT, v: 1, fields: ["id"], rows: [[legacy.rows[0][legacy.fields.indexOf("id")]]] };
            doc.buckets.push(project);
        }
        if (!project.rows.length) project.rows.push(project.fields.map(field =>
            field === "id" ? legacy.rows[0][legacy.fields.indexOf("id")] : undefined));
        for (const [oldField, field] of [["scale", "pointScale"], ["visibility", "pointVisibility"]]) {
            const value = legacy.rows[0][legacy.fields.indexOf(oldField)] ?? DEFAULTS[field];
            let index = project.fields.indexOf(field);
            if (index === -1) { index = project.fields.length; project.fields.push(field); }
            if (project.rows[0][index] == null) project.rows[0][index] = value;
        }
    }
    doc.buckets = doc.buckets.filter(b => b.name !== "pointSettings");
});

export function getProject() {
    const items = bucket(PROJECT).items;
    if (!items.length) items.push({ id: newId(), ...DEFAULTS });
    for (const [field, value] of Object.entries(DEFAULTS)) items[0][field] ??= value;
    return items[0];
}

export function updateProject(changes) {
    return Object.assign(getProject(), changes);
}

export function getView() {
    const p = getProject();
    return { cx: p.viewX ?? 0, cy: p.viewY ?? 0, zoom: p.viewZoom ?? 1 };
}

export function setView(cx, cy, zoom) {
    updateProject({ viewX: cx, viewY: cy, viewZoom: zoom });
}

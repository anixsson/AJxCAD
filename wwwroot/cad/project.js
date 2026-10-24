// The "project" bucket: one row of project-wide data (name, measuring system, 1:1 unit and the saved view).
// The view is the world point at the middle of the screen plus the zoom relative to 1:1, so it still makes
// sense on a different window size or unit. The bucket is not part of undo. More fields can be added later
// without breaking old files.

import { bucket, defineBucket, newId } from "./store.js";

export const PROJECT = "project";

defineBucket(PROJECT, { label: "Project", fields: ["id", "name", "imperial", "unitMm", "viewX", "viewY", "viewZoom"], undoable: false, group: "project" });

const DEFAULTS = { name: "Untitled", imperial: 0, unitMm: 100, viewX: 0, viewY: 0, viewZoom: 1 };

export function getProject() {
    const items = bucket(PROJECT).items;
    if (!items.length) items.push({ id: newId(), ...DEFAULTS });
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


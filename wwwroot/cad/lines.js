// The "lines" data bucket and how a line is drawn and edited.
// A geometry type exposes draw(), points() and setPoint(); the select tool works on any geometry
// that provides them, so future shape types plug in the same way.

import { bucket, defineBucket, newId } from "./store.js";

export const LINES = "lines";
const GLOW_MAX_LINES = 400;

defineBucket(LINES, { label: "Lines", fields: ["id", "x1", "y1", "x2", "y2"] });

export function addLine(x1, y1, x2, y2) {
    const line = { id: newId(), x1, y1, x2, y2 };
    bucket(LINES).items.push(line);
    return line;
}

export const lineGeometry = {
    bucket: LINES,

    draw(g, items, view) {
        const d = view.dpr;
        const { width: w, height: h } = view;
        g.beginPath();
        let visible = 0;
        for (const l of items) {
            const a = view.toScreen(l.x1, l.y1), b = view.toScreen(l.x2, l.y2);
            // Skip lines entirely on one side of the screen.
            if ((a.x < 0 && b.x < 0) || (a.x > w && b.x > w) || (a.y < 0 && b.y < 0) || (a.y > h && b.y > h)) continue;
            g.moveTo(a.x * d, a.y * d);
            g.lineTo(b.x * d, b.y * d);
            visible++;
        }
        g.lineCap = "round";
        g.lineWidth = 2 * d;
        g.strokeStyle = "#8fe3ff";
        // The blurred glow is the expensive part; only use it while the drawing is light.
        if (view.fx && visible <= GLOW_MAX_LINES) {
            g.shadowColor = "rgba(111,208,255,0.55)";
            g.shadowBlur = 6 * d;
        }
        g.stroke();
        g.shadowBlur = 0;
    },

    points: l => [
        { key: "a", x: l.x1, y: l.y1 },
        { key: "b", x: l.x2, y: l.y2 }
    ],

    setPoint(l, key, x, y) {
        if (key === "a") { l.x1 = x; l.y1 = y; }
        else { l.x2 = x; l.y2 = y; }
    },

    // Splits a line at (x, y): the line now ends there (end "b") and a new line runs on to the old end.
    // Returns the joint as [{ item, key }, ...] plus the new line.
    split(l, x, y) {
        const added = addLine(x, y, l.x2, l.y2);
        l.x2 = x;
        l.y2 = y;
        return { added, joint: [{ item: l, key: "b" }, { item: added, key: "a" }] };
    }
};

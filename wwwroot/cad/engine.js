// Canvas workspace: grid drawing, zoom, right-mouse-button panning, and the tool host.
// Everything pointer-related stays in JS so panning never round-trips through Blazor.
// Tools live in ./tools, data lives in per-tool buckets in ./store.js.

import { bucket, checkpoint, undo as undoData, describe, describePage, serialize, deserialize, clearAll } from "./store.js";
import { getProject, updateProject, getView, setView } from "./project.js";
import { addLine, lineGeometry } from "./lines.js";
import { generateLines } from "./test-data.js";
import { createLineTool } from "./tools/line.js";
import { createSelectTool } from "./tools/select.js";
import { createRulerTool } from "./tools/ruler.js";

const MIN_MINOR_PX = 12;
const SNAP_PX = 10;
let el, canvas, ctx, dotnet;
let refPx, unitMm, oneToOne; // 1:1 = one `unitMm` drawn as a `refPx` wide major grid cell
let scale, originX = 0, originY = 0; // scale in CSS px per mm, origin in CSS px
let panning = false, lastX = 0, lastY = 0, pointerId = -1;
let ro;
let centered = null;
let imperial = false;
let effects = true; // false = performance mode: no glows or blurs on the canvas
const handlers = [];

// Geometry types draw the stored buckets; tools only draw their own overlay.
const geometries = [lineGeometry];
const tools = {};
let toolId = "cross";

const toWorld = (sx, sy) => ({ x: (sx - originX) / scale, y: -(sy - originY) / scale });
const toScreen = (x, y) => ({ x: originX + x * scale, y: originY - y * scale });

function minorStepMm() {
    return niceAtLeast(MIN_MINOR_PX / (scale * unitMm)) * unitMm;
}

// Snaps to an existing endpoint if close, otherwise to the minor grid.
// `exclude(geo, item, key)` can skip points (such as the ones being dragged).
function snap(sx, sy, exclude) {
    const wc = toWorld(sx, sy);
    const reach = SNAP_PX / scale;
    for (const geo of geometries) {
        for (const item of bucket(geo.bucket).items) {
            for (const p of geo.points(item)) {
                if (Math.abs(p.x - wc.x) > reach || Math.abs(p.y - wc.y) > reach) continue;
                if (exclude?.(geo, item, p.key)) continue;
                const s = toScreen(p.x, p.y);
                if (Math.hypot(s.x - sx, s.y - sy) <= SNAP_PX) return { x: p.x, y: p.y, kind: "end" };
            }
        }
    }
    const w = toWorld(sx, sy);
    const g = minorStepMm();
    return { x: Math.round(w.x / g) * g, y: Math.round(w.y / g) * g, kind: "grid" };
}

function formatLength(mm) {
    if (imperial) {
        const inches = mm / 25.4;
        if (inches < 12) return `${+inches.toFixed(3)} in`;
        return `${+(inches / 12).toFixed(3)} ft`;
    }
    if (mm < 10) return `${+mm.toFixed(3)} mm`;
    if (mm < 1000) return `${+(mm / 10).toFixed(3)} cm`;
    return `${+(mm / 1000).toFixed(3)} m`;
}

function formatArea(mm2) {
    if (imperial) {
        const sqIn = mm2 / 645.16;
        if (sqIn < 144) return `${+sqIn.toFixed(3)} in²`;
        return `${+(sqIn / 144).toFixed(3)} ft²`;
    }
    if (mm2 < 100) return `${+mm2.toFixed(3)} mm²`;
    if (mm2 < 1e6) return `${+(mm2 / 100).toFixed(3)} cm²`;
    return `${+(mm2 / 1e6).toFixed(3)} m²`;
}

// Sends a line to the on-screen debug log.
function log(kind, text) {
    dotnet?.invokeMethodAsync("OnLog", kind, text);
}

// Keeps a scrolling log pinned to the newest line, unless the user has scrolled up to read.
const stuck = new WeakMap();
export function stickToBottom(box) {
    if (!box) return;
    if (!stuck.has(box)) {
        stuck.set(box, true);
        box.addEventListener("scroll", () => {
            stuck.set(box, box.scrollTop + box.clientHeight >= box.scrollHeight - 4);
        });
    }
    if (stuck.get(box)) box.scrollTop = box.scrollHeight;
}

const env = {
    geometries,
    toWorld,
    toScreen,
    snap,
    minorStepMm,
    formatLength,
    formatArea,
    log,
    redraw: () => draw(),
    setTool: name => setTool(name),
    selectionChanged: count => dotnet?.invokeMethodAsync("OnSelectionChanged", count),
    processChanged: state => dotnet?.invokeMethodAsync("OnProcessChanged", state?.step ?? null, !!state?.hasBase),
    measureChanged: info => dotnet?.invokeMethodAsync("OnMeasureChanged", info),
    capture: id => el.setPointerCapture(id)
};

const currentTool = () => tools[toolId];

export function setTool(name) {
    if (!tools[name] || name === toolId) return;
    log("action", `tool: ${toolId} -> ${name}`);
    currentTool().deactivate?.();
    toolId = name;
    el.classList.toggle("drawing", toolId !== "cross");
    el.classList.toggle("tool-select", toolId === "select");
    draw();
    dotnet.invokeMethodAsync("OnToolChanged", toolId);
}

export function setImperial(value) {
    imperial = value;
    draw();
}

export function setSelectionMode(mode) {
    tools.select.setSelectionMode(mode);
}

// Guided Move on the current selection (Select tool action menu).
export const startMove = () => tools.select.startMove();
export const confirmMoveBase = () => tools.select.confirmMoveBase();
export const cancelProcess = () => tools.select.cancelProcess();

export const setRulerSnap = mode => tools.ruler.setSnapMode(mode);
export const rulerAddPoints = () => tools.ruler.addPoints();
export const rulerStop = () => tools.ruler.stop();

// Esc first cancels what the current tool is doing (a measurement, a Move); returns false if there was nothing.
export function cancelCurrent() {
    const tool = currentTool();
    return !!(tool.cancel ?? tool.cancelProcess)?.call(tool);
}

export function undo() {
    if (currentTool().undoStep?.()) {
        log("action", "undo (cancel current)");
    } else {
        log("action", undoData() ? "undo" : "undo (nothing to undo)");
        for (const t of Object.values(tools)) t.dataChanged?.();
    }
    draw();
}

function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    handlers.push(() => target.removeEventListener(type, fn, opts));
}

// Smallest 1-2-5 value (x 10^n) that is >= value.
function niceAtLeast(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
}

function notify() {
    dotnet.invokeMethodAsync("OnScaleChanged", scale);
}

function zoomAt(factor, x, y) {
    cancelAnimation();
    const min = oneToOne / 1000, max = oneToOne * 100;
    const next = Math.min(max, Math.max(min, scale * factor));
    const applied = next / scale;
    originX = x - (x - originX) * applied;
    originY = y - (y - originY) * applied;
    scale = next;
    draw();
    notify();
}

function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(el.clientWidth * dpr));
    const h = Math.max(1, Math.round(el.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
    }
    draw();
}

// Many pointer events can arrive per frame; draw at most once per frame.
let framePending = false;
function draw() {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(() => {
        framePending = false;
        render();
    });
}

// Draws in device pixels, with every line snapped to whole pixels so all lines look identical.
function render() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width, h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const stepPx = niceAtLeast(MIN_MINOR_PX / (scale * unitMm)) * unitMm * scale * dpr; // device px per minor cell
    const ox = originX * dpr, oy = originY * dpr;
    const minorW = Math.max(1, Math.round(dpr));
    const majorW = Math.max(2, Math.round(dpr * 2));

    const lines = (vertical, major) => {
        const length = vertical ? w : h;
        const origin = vertical ? ox : oy;
        const first = Math.ceil((0 - origin) / stepPx);
        const last = Math.floor((length - origin) / stepPx);
        const width = major ? majorW : minorW;
        ctx.fillStyle = major ? "rgba(201,182,255,0.36)" : "rgba(169,140,255,0.15)";
        for (let i = first; i <= last; i++) {
            if ((i % 10 === 0) !== major) continue;
            const p = Math.round(origin + i * stepPx - width / 2);
            if (vertical) ctx.fillRect(p, 0, width, h);
            else ctx.fillRect(0, p, w, width);
        }
    };

    lines(true, false); lines(false, false);
    lines(true, true); lines(false, true);

    // Axes through the world origin
    const aw = Math.max(2, Math.round(dpr * 2));
    ctx.shadowColor = "rgba(255,143,224,0.7)";
    ctx.shadowBlur = effects ? 8 * dpr : 0;
    ctx.fillStyle = "#ff8fe0";
    ctx.fillRect(Math.round(ox - aw / 2), 0, aw, h);
    ctx.fillRect(0, Math.round(oy - aw / 2), w, aw);
    ctx.shadowBlur = 0;

    const view = { dpr, toScreen, toWorld, width: el.clientWidth, height: el.clientHeight, fx: effects };
    for (const geo of geometries) geo.draw(ctx, bucket(geo.bucket).items, view);
    currentTool().draw?.(ctx, view);

    // Only tell Blazor when the "origin is centred" state flips, not on every pan frame.
    const isCentered = Math.abs(originX - el.clientWidth / 2) < 0.5 && Math.abs(originY - el.clientHeight / 2) < 0.5;
    if (isCentered !== centered) {
        centered = isCentered;
        dotnet.invokeMethodAsync("OnCenteredChanged", isCentered);
    }
}

export function init(workspace, canvasEl, dotnetRef, referencePx, unit) {
    el = workspace;
    canvas = canvasEl;
    ctx = canvas.getContext("2d");
    dotnet = dotnetRef;
    refPx = referencePx;
    unitMm = unit;
    oneToOne = refPx / unitMm;
    scale = oneToOne;
    originX = el.clientWidth / 2;
    originY = el.clientHeight / 2;

    tools.cross = { id: "cross", hotkey: "v" };
    tools.select = createSelectTool(env);
    tools.line = createLineTool(env);
    tools.ruler = createRulerTool(env);

    const toolEvent = e => {
        const r = el.getBoundingClientRect();
        return { sx: e.clientX - r.left, sy: e.clientY - r.top, shift: e.shiftKey, control: e.ctrlKey || e.metaKey, detail: e.detail, pointerId: e.pointerId };
    };

    // Right mouse button pans.
    on(el, "contextmenu", e => e.preventDefault());
    const mods = e => [e.metaKey && "cmd", e.ctrlKey && "ctrl", e.altKey && "alt", e.shiftKey && "shift"].filter(Boolean).join("+");
    on(window, "keydown", e => log("key", `down  key="${e.key}" code=${e.code}${mods(e) ? " +" + mods(e) : ""}${e.repeat ? " (repeat)" : ""}`), true);
    on(window, "keyup", e => log("key", `up    key="${e.key}" code=${e.code}`), true);
    // Tool shortcuts must not fire while a dialog is open or a text field has focus.
    const typing = e => !!document.querySelector(".modal-backdrop") || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || !!e.target?.isContentEditable;
    on(document, "keydown", e => {
        if (e.key === "Escape") {
            log("action", `Escape handled (tool=${toolId})`);
            dotnet.invokeMethodAsync("OnEscape");
        } else if (e.key === " " && !e.metaKey && !e.ctrlKey && !e.altKey) {
            // Space presses the visible default button (marked data-default-action) of a guide or action box.
            if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable) return;
            const next = [...document.querySelectorAll("[data-default-action]")].find(b => !b.disabled && b.offsetParent);
            if (!next) return;
            e.preventDefault(); // also stops Space from pressing whichever button has focus
            if (!e.repeat) next.click();
        } else if ((e.metaKey || e.ctrlKey) && !e.altKey && ["n", "o", "s"].includes(e.key.toLowerCase())) {
            e.preventDefault();
            const k = e.key.toLowerCase();
            dotnet.invokeMethodAsync("OnFileCommand", k === "n" ? "new" : k === "o" ? "open" : e.shiftKey ? "saveas" : "save");
        } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
            if (typing(e)) return;
            e.preventDefault();
            undo();
        } else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
            if (typing(e)) return;
            const t = Object.values(tools).find(t => t.hotkey === e.key.toLowerCase());
            if (t) setTool(t.id);
        }
    });
    el.tabIndex = 0;
    el.style.outline = "none";
    on(el, "pointerdown", e => {
        if (document.activeElement !== el) el.focus({ preventScroll: true });
        if (e.button === 0) {
            log("mouse", `click detail=${e.detail}`);
            currentTool().pointerDown?.(toolEvent(e));
            return;
        }
        if (e.button !== 2) return;
        e.preventDefault();
        cancelAnimation();
        panning = true;
        log("mouse", "right button: pan start");
        pointerId = e.pointerId;
        lastX = e.clientX;
        lastY = e.clientY;
        el.setPointerCapture(e.pointerId);
        el.classList.add("panning");
    });
    on(el, "pointermove", e => {
        if (!panning) {
            currentTool().pointerMove?.(toolEvent(e));
            return;
        }
        if (e.pointerId !== pointerId) return;
        originX += e.clientX - lastX;
        originY += e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        draw();
    });
    const stop = e => {
        if (!panning || e.pointerId !== pointerId) return;
        panning = false;
        el.classList.remove("panning");
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    on(window, "blur", () => log("focus", "window lost focus"));
    on(window, "focus", () => log("focus", "window got focus"));
    on(el, "pointerleave", () => currentTool().pointerLeave?.());
    on(el, "pointerup", e => {
        if (panning) stop(e);
        else currentTool().pointerUp?.(toolEvent(e));
    });
    on(el, "pointercancel", e => {
        if (panning) stop(e);
        else currentTool().pointerUp?.(toolEvent(e));
    });
    on(el, "wheel", e => {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    notify();
    log("system", `ready  dpr=${window.devicePixelRatio} focus=${document.hasFocus()} active=<${document.activeElement?.tagName}>`);
}

export function zoomBy(factor) {
    zoomAt(factor, el.clientWidth / 2, el.clientHeight / 2);
}

const STEP = 0.1, HOLD_DELAY_MS = 350;
let holdTimer = 0, holdFrame = 0;

// One click moves the ratio by 0.1 on a single line through 1:1: ... 1:1.2, 1:1.1, 1:1, 1.1:1, 1.2:1 ...
// Off-grid values first snap to the next 0.1 in that direction.
function stepZoom(dir) {
    const z = scale / oneToOne;
    const p = z >= 1 ? z - 1 : 1 - 1 / z;
    const q = p / STEP;
    const r = Math.round(q);
    const onGrid = Math.abs(q - r) < 1e-6;
    const tq = onGrid ? r + dir : (dir > 0 ? Math.ceil(q) : Math.floor(q));
    const tp = tq * STEP;
    const target = Math.min(100, Math.max(0.001, tp >= 0 ? 1 + tp : 1 / (1 - tp)));
    if (Math.abs(target - z) > 1e-9) zoomAt(target / z, el.clientWidth / 2, el.clientHeight / 2);
}

// Press: step once; keep holding and the zoom runs continuously, gradually faster.
export function holdZoomStart(dir) {
    holdZoomStop();
    stepZoom(dir);
    holdTimer = setTimeout(() => {
        const t0 = performance.now();
        let last = t0;
        const tick = now => {
            const dt = (now - last) / 1000;
            last = now;
            const rate = 0.9 + Math.min(3.6, (now - t0) / 1000 * 1.2); // e-folds per second, ramps up
            zoomAt(Math.exp(dir * rate * dt), el.clientWidth / 2, el.clientHeight / 2);
            holdFrame = requestAnimationFrame(tick);
        };
        holdFrame = requestAnimationFrame(tick);
    }, HOLD_DELAY_MS);
}

// Release: stop where it is.
export function holdZoomStop() {
    clearTimeout(holdTimer);
    cancelAnimationFrame(holdFrame);
}

// Changes what 1:1 means and jumps to that 1:1 view, centred on the screen centre.
export function setReference(unit) {
    unitMm = unit;
    oneToOne = refPx / unitMm;
    zoomAt(oneToOne / scale, el.clientWidth / 2, el.clientHeight / 2);
}

// Glides the view to a new scale and origin: scale moves geometrically, so zooming feels even.
let animFrame = 0;

function cancelAnimation() {
    cancelAnimationFrame(animFrame);
    animFrame = 0;
}

function animateView(toScale, toX, toY, ms = 450) {
    cancelAnimation();
    const s0 = scale, x0 = originX, y0 = originY, t0 = performance.now();
    const tick = now => {
        const t = Math.min(1, (now - t0) / ms);
        const k = 1 - Math.pow(1 - t, 3); // ease out
        scale = s0 * Math.pow(toScale / s0, k);
        originX = x0 + (toX - x0) * k;
        originY = y0 + (toY - y0) * k;
        draw();
        notify();
        animFrame = t < 1 ? requestAnimationFrame(tick) : 0;
    };
    animFrame = requestAnimationFrame(tick);
}

// Puts the world origin in the middle of the screen without changing the scale.
export function center() {
    animateView(scale, el.clientWidth / 2, el.clientHeight / 2);
}

// Zooms to `target` around the middle of the screen.
export function setScale(target) {
    const cx = el.clientWidth / 2, cy = el.clientHeight / 2;
    const k = target / scale;
    animateView(target, cx - (cx - originX) * k, cy - (cy - originY) * k);
}

// Records the current view into the project bucket so it is saved with everything else.
function captureView() {
    const c = toWorld(el.clientWidth / 2, el.clientHeight / 2);
    setView(c.x, c.y, scale / oneToOne);
}

export const getBuckets = () => { captureView(); return describe(); };
export const getBucketPage = (name, offset) => describePage(name, offset);
export const getDataText = () => { captureView(); return serialize(); };

// Glides to the saved view; files saved without one leave the view alone.
export function restoreView() {
    if (getProject().viewZoom === undefined) return;
    const v = getView();
    const s = v.zoom * oneToOne;
    animateView(s, el.clientWidth / 2 - v.cx * s, el.clientHeight / 2 + v.cy * s, 600);
}

export function setEffects(on) {
    effects = on;
    log("action", `effects: ${on ? "full" : "performance mode"}`);
    draw();
}

export const getProjectData = () => ({ ...getProject() });

export function setProjectData(changes) {
    updateProject(changes);
}

export function generateTestLines(count, spacing) {
    const lines = generateLines(count, spacing, el.clientWidth, el.clientHeight);
    cancelAnimation();
    checkpoint();
    for (const line of lines) {
        const a = toWorld(line.x1, line.y1), b = toWorld(line.x2, line.y2);
        addLine(a.x, a.y, b.x, b.y);
    }
    for (const t of Object.values(tools)) t.deactivate?.();
    log("action", `added ${lines.length} test lines (spacing ${spacing} px)`);
    draw();
}

export function loadDataText(text) {
    const n = deserialize(text);
    for (const t of Object.values(tools)) t.dataChanged?.();
    log("action", `loaded ${n} bucket${n === 1 ? "" : "s"}`);
    draw();
    return n;
}

export function newProject() {
    clearAll();
    for (const t of Object.values(tools)) t.dataChanged?.();
    log("action", "new project");
    animateView(oneToOne, el.clientWidth / 2, el.clientHeight / 2, 600); // back to the origin at 1:1
    draw();
}

export function dispose() {
    cancelAnimation();
    holdZoomStop();
    handlers.forEach(h => h());
    handlers.length = 0;
    ro?.disconnect();
}

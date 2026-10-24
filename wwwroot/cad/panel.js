const bindings = new WeakMap();
export const clampWidth = (width, viewport) => Math.round(Math.max(280, Math.min(720, viewport - 32, width)));

export function attach(panel, dotnet) {
    let drag = null;
    const down = e => {
        if (e.button !== 0 || !e.target.classList.contains("panel-resize")) return;
        e.preventDefault();
        drag = { id: e.pointerId, x: e.clientX, width: panel.getBoundingClientRect().width };
        panel.setPointerCapture(e.pointerId);
    };
    const move = e => {
        if (!drag || e.pointerId !== drag.id) return;
        const width = clampWidth(drag.width + drag.x - e.clientX, window.innerWidth);
        panel.style.setProperty("--panel-width", `${width}px`);
    };
    const up = e => {
        if (!drag || e.pointerId !== drag.id) return;
        const width = clampWidth(drag.width + drag.x - e.clientX, window.innerWidth);
        drag = null;
        if (panel.hasPointerCapture(e.pointerId)) panel.releasePointerCapture(e.pointerId);
        dotnet.invokeMethodAsync("SaveWidth", width);
    };
    panel.addEventListener("pointerdown", down);
    panel.addEventListener("pointermove", move);
    panel.addEventListener("pointerup", up);
    panel.addEventListener("pointercancel", up);
    bindings.set(panel, () => {
        panel.removeEventListener("pointerdown", down);
        panel.removeEventListener("pointermove", move);
        panel.removeEventListener("pointerup", up);
        panel.removeEventListener("pointercancel", up);
    });
}

export function detach(panel) {
    bindings.get(panel)?.();
    bindings.delete(panel);
}

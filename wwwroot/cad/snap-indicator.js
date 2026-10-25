export function drawSnapIndicator(g, view, point) {
    if (!point) return;
    const d = view.dpr;
    const p = view.toScreen(point.x, point.y);
    const radius = ((point.kind === "end" || point.kind === "mid" || point.kind === "ref") ? 6 : 4) * d;
    g.lineWidth = 1.5 * d;
    g.strokeStyle = (point.kind === "end" || point.kind === "mid" || point.kind === "ref")
        ? (view.paper ? "#000" : "#ff8fe0")
        : (view.paper ? "rgba(0,0,0,0.8)" : "rgba(255,255,255,0.8)");
    g.strokeRect(p.x * d - radius, p.y * d - radius, radius * 2, radius * 2);
}

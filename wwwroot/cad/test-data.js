// Generate in screen coordinates so the border and spacing follow the current viewport.
export function generateLines(count, spacing, width, height, random = Math.random) {
    if (!Number.isInteger(count) || count < 1 || count > 10000)
        throw new Error("Line count must be an integer from 1 to 10,000.");
    if (!Number.isFinite(spacing) || spacing < 0 || spacing > 200)
        throw new Error("Spacing must be from 0 to 200 px.");
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 100 || height <= 100)
        throw new Error("The workspace must be larger than 100 px in each direction.");

    const border = 48;
    const halfLength = Math.min(16, (width - border * 2) / 4, (height - border * 2) / 4);
    const min = border + halfLength;
    const maxX = width - min, maxY = height - min;
    const reflect = (value, low, high) => {
        const span = high - low;
        const offset = ((value - low) % (span * 2) + span * 2) % (span * 2);
        return low + (offset <= span ? offset : span * 2 - offset);
    };
    let x = width / 2, y = height / 2;
    const lines = [];
    for (let i = 0; i < count; i++) {
        if (i > 0) {
            const direction = random() * Math.PI * 2;
            const distance = spacing * (0.5 + random());
            x = reflect(x + Math.cos(direction) * distance, min, maxX);
            y = reflect(y + Math.sin(direction) * distance, min, maxY);
        }
        const angle = random() * Math.PI * 2;
        const radius = halfLength * (0.25 + random() * 0.75);
        const dx = Math.cos(angle) * radius, dy = Math.sin(angle) * radius;
        lines.push({ x1: x - dx, y1: y - dy, x2: x + dx, y2: y + dy });
    }
    return lines;
}

/** Normalized travel in canvas pixels; the same endpoints drive preview and FFmpeg. */
export const CAMERA_MOTIONS = [
    ['push-in', 'Portrait push', 0, 0, 0, 0, 0, 1],
    ['pull-out', 'Context reveal', 0, 0, 0, 0, 1, 0],
    ['pan-left', 'Track left', 1, 0, -1, 0, 1, 1],
    ['pan-right', 'Track right', -1, 0, 1, 0, 1, 1],
    ['tilt-up', 'Look up', 0, 1, 0, -1, 1, 1],
    ['tilt-down', 'Look down', 0, -1, 0, 1, 1, 1],
    ['diagonal-rise', 'Diagonal rise', -1, 1, 1, -1, 1, 1],
    ['diagonal-fall', 'Diagonal fall', 1, -1, -1, 1, 1, 1],
    ['detail-approach', 'Approach the detail', -1, 0, 0, 0, 0.6, 1],
    ['detail-release', 'Leave the detail', 0, 0, 1, 0, 1, 0.6],
].map(([id, label, x0, y0, x1, y1, z0, z1]) => ({ id, label, x0, y0, x1, y1, z0, z1 }));

export function cameraEndpoints(t) {
    const preset = CAMERA_MOTIONS.find((m) => m.id === t.animation);
    if (!preset) return null;
    const amount = Math.max(0, Math.min(0.6, Number(t.animationAmount) || 0));
    // 80 px travel per 20% amount. Additional zoom gives overscan on ordinary portrait footage.
    const travel = amount * 400;
    return { x: t.x + preset.x0 * travel, y: t.y + preset.y0 * travel,
        xEnd: t.x + preset.x1 * travel, yEnd: t.y + preset.y1 * travel,
        scaleStart: t.scale * (1 + amount * preset.z0), scaleEnd: t.scale * (1 + amount * preset.z1) };
}

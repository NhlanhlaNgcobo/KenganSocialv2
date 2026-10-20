export type ScopeMode = 'waveform' | 'parade' | 'vectorscope' | 'histogram';

/** SDR display-referred measurements. No legal-range or HDR interpretation. */
export function scopePoints(data: Uint8ClampedArray, width: number, mode: ScopeMode) {
    const points: { x: number; y: number; channel: number }[] = [];
    const bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    let black = 0, white = 0;
    for (let i = 0; i < data.length; i += 4) {
        const rgb = [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
        const luma = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        if (rgb.some((c) => c <= 1 / 255)) black++;
        if (rgb.some((c) => c >= 254 / 255)) white++;
        const x = ((i / 4) % width) / Math.max(1, width - 1);
        if (mode === 'waveform') points.push({ x, y: 1 - luma, channel: 3 });
        if (mode === 'parade') rgb.forEach((c, channel) => points.push({ x: (x + channel) / 3, y: 1 - c, channel }));
        if (mode === 'vectorscope') points.push({ x: 0.5 + (rgb[2] - luma) / 1.8556, y: 0.5 - (rgb[0] - luma) / 1.5748, channel: 3 });
        rgb.forEach((_, channel) => bins[channel][data[i + channel]]++);
    }
    if (mode === 'histogram') {
        const max = Math.max(1, ...bins.flatMap((b) => Array.from(b)));
        bins.forEach((bin, channel) => bin.forEach((n, i) => points.push({ x: i / 255, y: 1 - n / max, channel })));
    }
    const total = Math.max(1, data.length / 4);
    return { points, black: black / total * 100, white: white / total * 100 };
}

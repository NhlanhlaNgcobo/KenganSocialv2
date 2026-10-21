/** Pure collection metadata and export filters; mirrored for independent deployments. */
export const TREND_EFFECTS = [
    { type: 'ks-impact-shake', label: 'Impact Shake', description: 'A damped camera jolt at the beginning of the clip.' },
    { type: 'ks-halation', label: 'Highlight Halation', description: 'Warm bloom isolated to bright areas. Preview approximates the glow.' },
    { type: 'ks-chromatic-echo', label: 'Chromatic Echo', description: 'Two-frame motion trails with displaced colour channels.', exportOnly: true },
    { type: 'ks-frame-cadence', label: 'Frame Cadence', description: 'Stop-motion frame sampling while audio keeps its timing.', exportOnly: true },
    { type: 'ks-digicam', label: 'Digicam', description: 'Crunchy sensor noise, clipped highlights and a compact-camera colour cast.' },
    { type: 'ks-spotlight', label: 'Breathing Spotlight', description: 'A softly breathing central pool of light.' },
    { type: 'ks-split-diopter', label: 'Split Diopter', description: 'Sharp left side and softly defocused right side. Preview approximates the split.' },
    { type: 'ks-prism-edge', label: 'Prism Edge', description: 'Coloured edge separation with a crisp central image. Preview approximates refraction.' },
    { type: 'ks-exposure-hit', label: 'Exposure Hit', description: 'One brief exposure bloom that decays from the cut.' },
    { type: 'ks-motion-smear', label: 'Motion Smear', description: 'Weighted temporal samples give movement a shutter-drag trail.', exportOnly: true },
];

export function trendEffectFilters(type, amount, W, H, index = 0, fps = 30) {
    const a = Math.min(1, Math.max(0, Number(amount) || 0));
    if (!a) return '';
    const label = `ksfx${index}`;
    switch (type) {
        case 'ks-impact-shake': {
            const amp = a * W * 0.018;
            const pad = Math.ceil(amp + 2);
            return `scale=${W + pad * 2}:${H + pad * 2},crop=${W}:${H}:x='${pad}+${amp}*exp(-9*t)*sin(72*t)':y='${pad}+${amp}*exp(-9*t)*cos(57*t)'`;
        }
        case 'ks-halation': {
            // lut2 computes the formula once per pair of values instead of per pixel (blend's
            // all_expr): the same picture, bit for bit, at about twice the speed.
            const glow = `x+max(0,y-180)*${(a * 0.55).toFixed(3)}`;
            return `split[${label}a][${label}b];[${label}b]gblur=sigma=${(2 + a * 12).toFixed(2)},colorbalance=rh=${(a * 0.2).toFixed(3)}[${label}g];[${label}a][${label}g]lut2=c0='${glow}':c1='${glow}':c2='${glow}'`;
        }
        case 'ks-chromatic-echo':
            return `tmix=frames=3:weights='1 0.5 0.25',rgbashift=rh=${Math.round(a * 12)}:bh=-${Math.round(a * 12)}`;
        case 'ks-frame-cadence':
            return `fps=${Math.round(24 - a * 16)},fps=${fps}`;
        case 'ks-digicam':
            return `noise=alls=${Math.round(a * 16)}:allf=t,eq=contrast=${1 + a * 0.3}:saturation=${1 - a * 0.15},colorbalance=bh=${-a * 0.1}:gh=${a * 0.03},unsharp=3:3:${a * 0.5}`;
        case 'ks-spotlight':
            return `vignette=angle='${0.2 + a * 0.6}+${a * 0.08}*sin(t*2)':eval=frame`;
        case 'ks-split-diopter':
            return `split[${label}a][${label}b];[${label}b]gblur=sigma=${(a * 18).toFixed(2)}[${label}g];[${label}a][${label}g]blend=all_expr='A*(1-clip((X/W-0.45)*10,0,1))+B*clip((X/W-0.45)*10,0,1)'`;
        case 'ks-prism-edge':
            return `split[${label}a][${label}b];[${label}b]rgbashift=rh=${Math.round(a * 20)}:bh=-${Math.round(a * 20)}[${label}g];[${label}a][${label}g]blend=all_expr='A*(1-pow(abs(X/W-0.5)*2,2))+B*pow(abs(X/W-0.5)*2,2)'`;
        case 'ks-exposure-hit':
            return `eq=brightness='${a * 0.22}*exp(-8*t)':eval=frame`;
        case 'ks-motion-smear':
            return `tmix=frames=${Math.round(2 + a * 4)}:weights='1 1 1 1 1 1'`;
        default: return '';
    }
}

export function trendEffectPreview(type, a, time, scale) {
    const out = { filter: '', transform: '', overlays: [] };
    if (a <= 0) return out;
    if (type === 'ks-impact-shake') {
        const amp = 19.44 * a * scale * Math.exp(-9 * Math.max(0, time));
        out.transform = `translate(${amp * Math.sin(72 * time)}px,${amp * Math.cos(57 * time)}px) scale(${1 + a * 0.04})`;
    }
    if (type === 'ks-halation') out.filter = `brightness(${1 + a * 0.06}) saturate(${1 + a * 0.08})`;
    if (type === 'ks-digicam') out.filter = `contrast(${1 + a * 0.3}) saturate(${1 - a * 0.15}) sepia(${a * 0.15})`;
    if (type === 'ks-exposure-hit') out.filter = `brightness(${1 + a * 0.7 * Math.exp(-8 * Math.max(0, time))})`;
    if (type === 'ks-spotlight') out.overlays.push({ background: `radial-gradient(ellipse, transparent ${45 - a * 20}%, rgba(0,0,0,${a * (0.6 + 0.06 * Math.sin(time * 2))}) 100%)` });
    if (type === 'ks-split-diopter') out.overlays.push({ left: '50%', backdropFilter: `blur(${a * 18 * scale}px)`, maskImage: 'linear-gradient(90deg, transparent, black 20%)' });
    if (type === 'ks-prism-edge') out.overlays.push({ background: `linear-gradient(90deg,rgba(0,220,255,${a * 0.18}),transparent 25%,transparent 75%,rgba(255,70,140,${a * 0.18}))`, mixBlendMode: 'screen' });
    return out;
}

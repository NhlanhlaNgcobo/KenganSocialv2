import { Easing, interpolate, spring } from 'remotion';

/** Small motion helpers shared by the launch/tutorial composition. Everything is a pure function of the frame. */

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };

export const ease = (frame, from, to, out = [0, 1], easing = Easing.out(Easing.cubic)) => interpolate(frame, [from, to], out, { ...clamp, easing });

export const pop = (frame, fps, delay = 0, config = { damping: 14, stiffness: 160, mass: 0.7 }) => spring({ frame: frame - delay, fps, config });

/** Transition style per tone: how a scene arrives and leaves. */
export const TRANSITIONS = {
    default: 'whip',
    'app-store': 'whip',
    'yc-parody': 'cut',
    chaotic: 'flash',
    polished: 'fade',
    deadpan: 'fade',
    cinematic: 'zoom',
    tutorial: 'slide',
};

/** Enter/exit transform for a scene container. */
export function sceneMotion(frame, duration, transition, fps) {
    if (transition === 'cut') return {};
    const inLen = Math.round(fps * (transition === 'fade' ? 0.5 : 0.3));
    const outLen = transition === 'flash' ? 0 : Math.round(fps * 0.22);
    const enter = ease(frame, 0, inLen);
    const exit = outLen ? ease(frame, duration - outLen, duration, [0, 1], Easing.in(Easing.cubic)) : 0;
    switch (transition) {
        case 'whip':
            return {
                transform: `translateX(${(1 - enter) * 22 - exit * 22}%)`,
                filter: `blur(${(1 - enter) * 14 + exit * 14}px)`,
                opacity: Math.min(1, enter * 1.6) * (1 - exit * 0.6),
            };
        case 'zoom':
            return { transform: `scale(${1.22 - enter * 0.22 - exit * 0.08})`, filter: `blur(${(1 - enter) * 10 + exit * 8}px)`, opacity: enter * (1 - exit) };
        case 'flash':
            return { transform: `scale(${1 + (1 - enter) * 0.14}) rotate(${(1 - enter) * -1.5}deg)` };
        case 'slide':
            return { transform: `translateY(${(1 - enter) * 4 - exit * 3}%)`, opacity: enter * (1 - exit) };
        default:
            return { opacity: enter * (1 - exit), transform: `scale(${1.02 - enter * 0.02})` };
    }
}

/** 0..1 pulse that jumps on each beat and decays — drives tiny "bumps" so the picture breathes with the music. */
export function beatPulse(timeSec, beats) {
    if (!beats?.length) return 0;
    let last = -1;
    for (const b of beats) {
        if (b > timeSec) break;
        last = b;
    }
    if (last < 0) return 0;
    return Math.exp(-(timeSec - last) * 7);
}

/** Perceived lightness 0..1 of a hex/rgb colour (rough). */
export function lightness(color) {
    const c = String(color || '').toLowerCase();
    let m = c.match(/^#([0-9a-f]{6})$/);
    if (m) {
        const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    m = c.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/);
    if (m) return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255;
    return 0.5;
}

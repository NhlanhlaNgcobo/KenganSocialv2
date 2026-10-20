/**
 * Kengan motion collection. Pure deterministic definitions, mirrored on the server.
 * Pixel samplers use the current YUV plane; no mutable expression registers.
 * CSS previews approximate spatial sampling, while export evaluates every pixel.
 */
export const TREND_TRANSITIONS = [
    { type: 'ks-whip-carry', label: 'Whip Carry', description: 'A fast lateral camera move that catches the next shot.', group: 'Kengan motion' },
    { type: 'ks-crash-reveal', label: 'Crash Reveal', description: 'Punch into the subject, then settle into the reveal.', group: 'Kengan motion' },
    { type: 'ks-spin-catch', label: 'Spin Catch', description: 'Rotate through the cut and catch the next frame upright.', group: 'Kengan motion' },
    { type: 'ks-lens-cover', label: 'Lens Cover', description: 'A soft lens-cover blackout for outfit and location changes.', group: 'Kengan motion' },
    { type: 'ks-focus-snap', label: 'Focus Snap', description: 'A sampled defocus burst followed by a clean reveal.', group: 'Kengan motion' },
    { type: 'ks-tear-through', label: 'Tear Through', description: 'An irregular paper edge peels across a memory or product shot.', group: 'Kengan motion' },
    { type: 'ks-shutter-roll', label: 'Shutter Roll', description: 'A rolling exposure band carries a vertical frame displacement.', group: 'Kengan motion' },
    { type: 'ks-elastic-pull', label: 'Elastic Pull', description: 'Stretch into the cut and rebound into the incoming shot.', group: 'Kengan motion' },
    { type: 'ks-prism-pass', label: 'Prism Pass', description: 'A refracted strip sweeps across the cut with a chromatic edge.', group: 'Kengan motion' },
    { type: 'ks-luma-bloom', label: 'Luma Bloom', description: 'Incoming highlights reveal first, followed by the shadows.', group: 'Kengan motion' },
];

const q = '(1-P)';
const ease = `(${q}*${q}*(3-2*${q}))`;
const pulse = `sin(PI*${q})`;
const sample = (which, x, y) =>
    `if(eq(PLANE,0),${which}0(clip(${x},0,W-1),clip(${y},0,H-1)),if(eq(PLANE,1),${which}1(clip(${x},0,W-1),clip(${y},0,H-1)),${which}2(clip(${x},0,W-1),clip(${y},0,H-1))))`;
const cross = (a, b) => `((${a})*P+(${b})*${q})`;
const zoom = (which, z) => sample(which, `W/2+(X-W/2)/(${z})`, `H/2+(Y-H/2)/(${z})`);
const rotate = (which, angle) => sample(which,
    `W/2+((X-W/2)*cos(${angle})-(Y-H/2)*sin(${angle}))/(1+0.45*${pulse})`,
    `H/2+((X-W/2)*sin(${angle})+(Y-H/2)*cos(${angle}))/(1+0.45*${pulse})`);
const tear = `(X/W-0.018*sin(Y/H*91)-0.012*sin(Y/H*233)-${ease}*1.12+0.06)`;
const prism = `(X/W-${ease}*1.3+0.15)`;
const defocus = (which) => `(${sample(which, `X+W*0.035*${pulse}`, 'Y')}+${sample(which, `X-W*0.035*${pulse}`, 'Y')}+${sample(which, 'X', `Y+H*0.035*${pulse}`)}+${sample(which, 'X', `Y-H*0.035*${pulse}`)})/4`;
const cover = `pow(${pulse},3)`;
const lumaMix = `clip((${ease}*1.12-0.06-(1-b0(X,Y)/255))/0.06+0.5,0,1)`;

const expressions = {
    'ks-whip-carry': cross(sample('a', `X+W*0.8*${ease}`, 'Y'), sample('b', `X-W*0.8*(1-${ease})`, 'Y')),
    'ks-crash-reveal': cross(zoom('a', `1+1.8*${ease}`), zoom('b', `1+0.65*(1-${ease})`)),
    'ks-spin-catch': cross(rotate('a', `${ease}*1.3`), rotate('b', `(${ease}-1)*1.3`)),
    'ks-lens-cover': `if(eq(PLANE,0),(${cross('A', 'B')})*(1-${cover}),(${cross('A', 'B')})*(1-${cover})+128*${cover})`,
    'ks-focus-snap': cross(defocus('a'), defocus('b')),
    'ks-tear-through': `if(lt(abs(${tear}),0.009),if(eq(PLANE,0),235,128),if(lt(${tear},0),B,A))`,
    'ks-shutter-roll': `if(lt(abs(Y/H-${ease}),0.07*${pulse}),if(eq(PLANE,0),225,128),if(lt(Y/H,${ease}),${sample('b', 'X', `Y-H*0.16*(1-${ease})`)},${sample('a', 'X', `Y+H*0.16*${ease}`)}))`,
    'ks-elastic-pull': cross(zoom('a', `1+0.9*${pulse}`), sample('b', `W/2+(X-W/2)/(1+0.7*${pulse})`, `H/2+(Y-H/2)*(1+0.18*${pulse})`)),
    'ks-prism-pass': `if(lt(abs(${prism}),0.12*${pulse}),${sample('b', `X+W*0.06*sin(${prism}*25)+PLANE*W*0.008*${pulse}`, 'Y')},if(lt(${prism},0),B,A))`,
    'ks-luma-bloom': `A*(1-${lumaMix})+B*${lumaMix}`,
};

export const TREND_XFADE = Object.fromEntries(Object.entries(expressions).map(([id, expr]) => [
    id, `custom:expr='if(gte(P,0.9999),A,if(lte(P,0.0001),B,${expr}))'`,
]));

export function trendTransitionStyles(type, progress) {
    const p = Math.max(0, Math.min(1, progress));
    if (!Object.hasOwn(expressions, type)) return null;
    if (p === 0) return { a: {}, b: { opacity: 0 } };
    if (p === 1) return { a: {}, b: { opacity: 1 } };
    const e = p * p * (3 - 2 * p);
    const pulseValue = Math.sin(Math.PI * p);
    const both = (a, b) => ({ a, b: { opacity: p, ...b } });
    switch (type) {
        case 'ks-whip-carry': return both({ transform: `translateX(${-80 * e}%)` }, { transform: `translateX(${80 * (1 - e)}%)` });
        case 'ks-crash-reveal': return both({ transform: `scale(${1 + 1.8 * e})` }, { transform: `scale(${1 + 0.65 * (1 - e)})` });
        case 'ks-spin-catch': return both({ transform: `rotate(${-e * 74.5}deg) scale(${1 + 0.45 * pulseValue})` }, { transform: `rotate(${(1 - e) * 74.5}deg) scale(${1 + 0.45 * pulseValue})` });
        case 'ks-lens-cover': return { ...both({}, {}), wash: { background: '#000', opacity: pulseValue ** 3 } };
        case 'ks-focus-snap': return both({ filter: `blur(${pulseValue * 14}px)` }, { filter: `blur(${pulseValue * 14}px)` });
        case 'ks-tear-through': {
            const edge = e * 112 - 6;
            const points = Array.from({ length: 41 }, (_, i) => `${edge + 1.8 * Math.sin(i / 40 * 91) + 1.2 * Math.sin(i / 40 * 233)}% ${i * 2.5}%`).join(',');
            return { a: {}, b: { clipPath: `polygon(0 0,${points},0 100%)` } };
        }
        case 'ks-shutter-roll': return { a: { transform: `translateY(${-16 * e}%)` }, b: { clipPath: `inset(0 0 ${100 * (1 - e)}% 0)`, transform: `translateY(${16 * (1 - e)}%)` }, wash: { background: `linear-gradient(transparent ${e * 100 - 4}%, #fff ${e * 100}%, transparent ${e * 100 + 4}%)`, opacity: pulseValue } };
        case 'ks-elastic-pull': return both({ transform: `scale(${1 + 0.9 * pulseValue})` }, { transform: `scale(${1 + 0.7 * pulseValue},${1 / (1 + 0.18 * pulseValue)})` });
        case 'ks-prism-pass': return { a: {}, b: { clipPath: `inset(0 ${Math.max(0, 100 - e * 130 + 15)}% 0 0)` }, wash: { background: `linear-gradient(90deg, transparent ${e * 130 - 23}%, #71f0ff ${e * 130 - 15}%, #e996ff ${e * 130 - 10}%, transparent ${e * 130 - 3}%)`, opacity: pulseValue * 0.4, mixBlendMode: 'screen' } };
        default: return both({}, { filter: `brightness(${1 + (1 - e) * 2})`, opacity: e });
    }
}

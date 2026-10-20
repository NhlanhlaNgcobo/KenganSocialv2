import path from 'path';
import { fileURLToPath } from 'url';
import { FFMPEG, run } from './ffmpeg-runner.js';

/**
 * Clip clean-up: video enhancement and sound cleaning in one FFmpeg pass, producing a new file
 * (the editor swaps it in for the original; undo restores it).
 *
 * Video (FFmpeg filters):
 *  - denoise   hqdn3d (light/medium) or nlmeans (strong, slow, best on short clips)
 *  - sharpen   cas: AMD FidelityFX Contrast Adaptive Sharpening
 *  - deband    smooths colour banding in skies and gradients
 *  - deflicker evens out brightness flicker (lights, timelapses)
 *  - autoLevels normalize: stretches each frame's black and white points (flat, washed-out footage)
 *
 * Sound:
 *  - noise     RNNoise neural noise suppression (arnndn, models from github.com/GregorR/rnnoise-models)
 *              or FFT spectral denoise (afftdn) for steady hiss/hum-like noise
 *  - hum       notches at the mains frequency and harmonics (50 Hz in South Africa, 60 Hz US)
 *  - declick   removes clicks and pops (adeclick)
 *  - clarity   voice clarity: rumble cut, presence lift, gentle compression
 *  - deess     tames harsh "s" sounds (deesser)
 *  - loudness  EBU R128 loudness normalisation (loudnorm): -14 LUFS social, -16 LUFS podcast
 */

const MODELS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/rnnoise');
const MODELS = { voice: 'sh.rnnn', 'voice-laughter': 'bd.rnnn', general: 'mp.rnnn' };

const num = (v, d, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);

export function normalizeCleanup(raw = {}) {
    const v = raw.video || {};
    const a = raw.audio || {};
    return {
        video: {
            denoise: ['off', 'light', 'medium', 'strong'].includes(v.denoise) ? v.denoise : 'off',
            sharpen: num(v.sharpen, 0, 0, 1),
            deband: !!v.deband,
            deflicker: !!v.deflicker,
            autoLevels: !!v.autoLevels,
        },
        audio: {
            noise: ['off', 'voice', 'voice-laughter', 'general', 'fft'].includes(a.noise) ? a.noise : 'off',
            strength: num(a.strength, 0.85, 0.1, 1),
            hum: ['off', '50', '60'].includes(String(a.hum)) ? String(a.hum) : 'off',
            declick: !!a.declick,
            clarity: !!a.clarity,
            deess: !!a.deess,
            loudness: ['off', 'social', 'podcast'].includes(a.loudness) ? a.loudness : 'off',
        },
    };
}

export function videoCleanupFilters(v) {
    const f = [];
    if (v.denoise === 'light') f.push('hqdn3d=2:1.5:3:3');
    if (v.denoise === 'medium') f.push('hqdn3d=4:3:6:4.5');
    if (v.denoise === 'strong') f.push('nlmeans=s=3.5:p=7:r=13');
    if (v.deband) f.push('deband=1thr=0.02:2thr=0.02:3thr=0.02:blur=1');
    if (v.deflicker) f.push('deflicker=size=7:mode=pm');
    if (v.autoLevels) f.push('normalize=smoothing=24:independence=0.6:strength=0.85');
    if (v.sharpen > 0) f.push(`cas=strength=${v.sharpen.toFixed(2)}`);
    return f;
}

/** Audio filters. Model paths are relative: the command runs with cwd = the models folder. */
export function audioCleanupFilters(a) {
    const f = [];
    if (a.clarity || a.noise !== 'off') f.push('highpass=f=70');
    if (a.hum !== 'off') {
        const base = Number(a.hum);
        for (const k of [1, 2, 3, 4]) f.push(`bandreject=f=${base * k}:width_type=q:w=25`);
    }
    if (a.declick) f.push('adeclick');
    if (a.noise === 'fft') f.push(`afftdn=nr=${Math.round(8 + a.strength * 16)}:nf=-42:tn=1`);
    else if (a.noise !== 'off') f.push(`arnndn=m=${MODELS[a.noise]}:mix=${a.strength.toFixed(2)}`);
    if (a.deess) f.push('deesser=i=0.4');
    if (a.clarity) {
        f.push('equalizer=f=200:t=q:w=1:g=-2', 'equalizer=f=3200:t=q:w=1.2:g=3');
        f.push('acompressor=threshold=-20dB:ratio=3:attack=8:release=120:makeup=2');
    }
    if (a.loudness !== 'off') f.push(`loudnorm=I=${a.loudness === 'podcast' ? -16 : -14}:TP=-1.5:LRA=11`);
    return f;
}

export const hasCleanup = (c) => videoCleanupFilters(c.video).length > 0 || audioCleanupFilters(c.audio).length > 0;

/**
 * Applies the clean-up to `inputPath`, writing `outputPath`. Video is re-encoded only when a video
 * filter is set; audio only when an audio filter is set.
 * @param {{ hasVideo: boolean, hasAudio: boolean, duration: number }} info probe result
 */
export async function applyCleanup(inputPath, outputPath, cleanup, info, onProgress = () => {}) {
    const vf = info.hasVideo ? videoCleanupFilters(cleanup.video) : [];
    const af = info.hasAudio ? audioCleanupFilters(cleanup.audio) : [];
    if (!vf.length && !af.length) throw new Error(info.hasAudio ? 'Choose at least one clean-up option.' : 'This clip has no sound to clean.');
    const args = ['-hide_banner', '-y', '-i', path.resolve(inputPath)];
    if (info.hasVideo) {
        if (vf.length) args.push('-vf', vf.join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p');
        else args.push('-c:v', 'copy');
    }
    if (info.hasAudio) {
        if (af.length) args.push('-af', af.join(','), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000');
        else args.push('-c:a', 'copy');
    }
    args.push('-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', path.resolve(outputPath));
    await run(FFMPEG, args, { cwd: MODELS_DIR, duration: info.duration || 1, onProgress });
    return { video: vf.length > 0, audio: af.length > 0 };
}

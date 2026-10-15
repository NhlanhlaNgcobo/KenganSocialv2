import fs from 'fs';
import path from 'path';
import { FFMPEG, run } from '../ffmpeg-runner.js';

/**
 * Sound effects for transitions and on-screen actions, synthesised with FFmpeg
 * (no samples, so nothing to license). Generated once and cached as small WAV files.
 */

const DIR = path.join(process.cwd(), '.cache', 'sfx');

const RECIPES = {
    // Air rushing past: pink noise through a band-pass, swelling then dying.
    whoosh: 'anoisesrc=color=pink:duration=0.55:amplitude=0.9:seed=7,bandpass=f=1400:width_type=o:w=2.2,afade=t=in:d=0.28:curve=exp,afade=t=out:st=0.28:d=0.27:curve=exp,volume=1.6',
    // Soft UI pop for things appearing.
    pop: 'sine=frequency=880:duration=0.09,afade=t=out:st=0:d=0.09:curve=exp,volume=0.7',
    // Mouse click: a very short bright tick plus a tiny low thump.
    click: 'anoisesrc=color=white:duration=0.025:amplitude=0.8:seed=3,highpass=f=2500,afade=t=out:st=0:d=0.025,volume=1.2',
    // Low hit for the logo / big reveal.
    impact: 'sine=frequency=52:duration=0.7,afade=t=out:st=0.05:d=0.65:curve=exp,volume=2.2',
    // Keyboard tick for typing animations.
    key: 'anoisesrc=color=white:duration=0.018:amplitude=0.5:seed=11,bandpass=f=3200:width_type=o:w=1.5,afade=t=out:st=0:d=0.018',
    // Rising build into the hook.
    riser: 'anoisesrc=color=pink:duration=1.2:amplitude=0.6:seed=5,highpass=f=600,afade=t=in:d=1.15:curve=qsin,afade=t=out:st=1.15:d=0.05,volume=0.9',
};

let cache = null;

/** @returns {Promise<Record<string,string>>} effect name → WAV data URL ({} if FFmpeg fails) */
export async function getSfx() {
    if (cache) return cache;
    fs.mkdirSync(DIR, { recursive: true });
    const out = {};
    for (const [name, recipe] of Object.entries(RECIPES)) {
        const file = path.join(DIR, `${name}.wav`);
        try {
            if (!fs.existsSync(file)) {
                await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', recipe, '-ac', '2', '-ar', '44100', file]);
            }
            out[name] = `data:audio/wav;base64,${fs.readFileSync(file).toString('base64')}`;
        } catch (error) {
            console.warn(`[SFX] Could not make "${name}":`, error.message);
        }
    }
    cache = out;
    return out;
}

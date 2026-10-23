// Manual integration test: real cutout, Remotion 3D render and FFmpeg export with a test-tone narration.
// Uses the locally cached live ElevenLabs/Treblo samples when present; makes no paid API calls.
// Usage: node tests/video-ads/render-smoke.mjs [preset] [format] [seconds]
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { FFMPEG } from '../../src/services/ffmpeg-runner.js';
import { ROOT, jobDirectory, saveJson, exists, probe } from '../../src/services/video-ads/media.js';
import { normalizeSource } from '../../src/services/video-ads/validation.js';
import { prepareDraft } from '../../src/services/video-ads/drafts.js';
import { renderAd } from '../../src/services/video-ads/pipeline.js';

const [preset = 'turntable', format = 'vertical', seconds = '15'] = process.argv.slice(2);
const dir = jobDirectory(randomUUID());
await fs.mkdir(dir, { recursive: true });
const bottle = (label, fill) => sharp(Buffer.from(`<svg width="900" height="1100" xmlns="http://www.w3.org/2000/svg"><rect width="900" height="1100" fill="#ffffff"/><rect x="300" y="230" width="300" height="680" rx="80" fill="${fill}"/><rect x="370" y="140" width="160" height="120" rx="20" fill="#1f2a24"/><rect x="300" y="460" width="300" height="200" fill="#f2e6cf"/><text x="450" y="575" text-anchor="middle" font-size="44" font-weight="700" font-family="Arial" fill="#1f2a24">${label}</text></svg>`)).jpeg().toBuffer();
const files = [{ buffer: await bottle('FRONT', '#2f7d5b') }, { buffer: await bottle('SIDE', '#2a6a4e') }, { buffer: await bottle('BACK', '#245c44') }];
const input = normalizeSource({ name: 'Everyday Bottle', tagline: 'Cold for 24 hours.', points: JSON.stringify(['Leak-proof lid', 'Recycled steel', 'Fits every cup holder']), offer: '20% off this week', website: 'everydaybottle.co.za', preset, format, duration: Number(seconds) }, files.length);
await saveJson(dir, 'draft.json', await prepareDraft(input, files, {}));

const liveSpeech = await exists(path.join(ROOT, 'live-speech.mp3'));
if (liveSpeech) await fs.copyFile(path.join(ROOT, 'live-speech.mp3'), path.join(dir, 'speech.mp3'));
else await promisify(execFile)(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-af', 'volume=0.1', '-c:a', 'libmp3lame', path.join(dir, 'speech.mp3')], { windowsHide: true });
const text = [...'This is a render test.'];
if (liveSpeech) await fs.copyFile(path.join(ROOT, 'live-speech-alignment.json'), path.join(dir, 'alignment.json'));
else await saveJson(dir, 'alignment.json', { characters: text, character_start_times_seconds: text.map((_, i) => i * 0.15), character_end_times_seconds: text.map((_, i) => (i + 1) * 0.15) });
const liveMusic = path.join(ROOT, 'live-music.mp3');
const hasMusic = await exists(liveMusic);
if (hasMusic) await fs.copyFile(liveMusic, path.join(dir, 'music-original.mp3'));

let last = -1;
const result = await renderAd(dir, { voiceover: process.env.NO_VOICE ? false : true, script: 'This is a render test.', voiceId: 'fixture', music: hasMusic, mood: 'auto', captions: true, sfx: true }, async (stage, progress) => {
    if (Math.floor(progress / 10) !== last) {
        last = Math.floor(progress / 10);
        console.log(`${stage}: ${progress}%`);
    }
});
const metadata = await probe(path.join(dir, 'ad.mp4'));
await saveJson(ROOT, 'render-smoke-result.json', { dir, preset, format, ...result, liveSpeech, liveMusic: hasMusic, streams: metadata.streams.map((s) => ({ type: s.codec_type, codec: s.codec_name })) });
console.log(JSON.stringify({ dir, preset, format, ...result, liveSpeech, liveMusic: hasMusic }));

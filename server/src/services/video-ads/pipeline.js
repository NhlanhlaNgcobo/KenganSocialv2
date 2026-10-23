import fs from 'node:fs/promises';
import path from 'node:path';
import { createSpeech, startMusic, waitForMusic } from './providers.js';
import { captionsFromAlignment, problem } from './validation.js';
import { exists, readJson, saveJson, probe, prepareMusic, finalizeExport } from './media.js';
import { CATEGORIES, resolveMood } from './catalog.js';
import { renderProductAd } from './render.js';
import { beatsOf } from '../brag/soundtrack.js';
import { getSfx } from '../brag/sfx.js';
import { inChromeQueue } from '../marketing/chrome-queue.js';

const dataUrl = async (file) => `data:audio/mpeg;base64,${(await fs.readFile(file)).toString('base64')}`;

/**
 * Voiceover (ElevenLabs) → soundtrack composed for the product type and mood (Treblo) →
 * 3D product render. Provider results are kept in the job directory, so a retried job never
 * pays for the same voiceover or soundtrack twice.
 */
export async function renderAd(dir, settings, update = async () => {}) {
    const draft = await readJson(dir, 'draft.json');
    const seconds = draft.input.duration;
    const speechPath = path.join(dir, 'speech.mp3');
    // Jobs queued before voiceover became optional have no flag and always had one.
    const voiceover = settings.voiceover !== false;
    let alignment = null;
    if (voiceover) {
        await update('Recording the voiceover', 15);
        if (!(await exists(speechPath))) {
            const speech = await createSpeech(settings.script, settings.voiceId);
            await saveJson(dir, 'alignment.json', speech.alignment);
            await fs.writeFile(`${speechPath}.tmp`, speech.audio);
            await fs.rename(`${speechPath}.tmp`, speechPath);
        }
        const speechInfo = await probe(speechPath);
        if (Number(speechInfo.format.duration) > seconds - 0.25) throw problem(400, 'This voiceover is too long. Shorten the script and generate a new ad.');
        alignment = await readJson(dir, 'alignment.json');
    }

    let music = null;
    let beats = [];
    if (settings.music) {
        const mood = resolveMood(settings.mood, draft.input.category);
        await update('Composing the music', 30);
        const rawPath = path.join(dir, 'music-original.mp3');
        if (!(await exists(rawPath))) {
            let task;
            if (await exists(path.join(dir, 'music-task.json'))) task = await readJson(dir, 'music-task.json');
            else {
                const subject = CATEGORIES[draft.input.category]?.subject || '';
                task = { id: await startMusic(mood, fetch, { purpose: 'ad', seconds, subject }), mood };
                await saveJson(dir, 'music-task.json', task);
            }
            await fs.writeFile(rawPath, await waitForMusic(task.id));
        }
        const musicPath = path.join(dir, 'music.mp3');
        await prepareMusic(rawPath, musicPath, seconds);
        music = await dataUrl(musicPath);
        beats = await beatsOf(musicPath).catch(() => []);
    }

    await update('Rendering your 3D ad', 45);
    const sfx = settings.sfx === false ? {} : await getSfx().catch(() => ({}));
    const narration = voiceover ? await dataUrl(speechPath) : null;
    const video = await inChromeQueue(() =>
        renderProductAd({
            draft,
            settings,
            music,
            beats,
            narration,
            captions: voiceover ? captionsFromAlignment(alignment) : [],
            sfx,
            onProgress: (p) => {
                void update('Rendering your 3D ad', 45 + Math.round(p * 48));
            },
        })
    );
    try {
        await update('Checking export', 96);
        const length = await finalizeExport(video.outputPath, path.join(dir, 'ad.mp4'), seconds);
        await fs.copyFile(video.posterPath, path.join(dir, 'poster.jpg'));
        return { seconds: length, width: video.width, height: video.height };
    } finally {
        await fs.unlink(video.outputPath).catch(() => {});
        await fs.unlink(video.posterPath).catch(() => {});
    }
}

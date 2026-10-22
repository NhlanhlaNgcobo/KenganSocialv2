import fs from 'node:fs/promises';
import path from 'node:path';
import { createSpeech, startMusic, waitForMusic } from './providers.js';
import { captionsFromAlignment, problem } from './validation.js';
import { exists, readJson, saveJson, probe, prepareMusic, finalizeExport } from './media.js';
import { renderLaunchVideo } from '../brag/render.js';
import { inChromeQueue } from '../marketing/chrome-queue.js';

export async function renderAd(dir, settings, update = async () => {}) {
    const draft = await readJson(dir, 'draft.json');
    const speechPath = path.join(dir, 'speech.mp3');
    await update('Generating voiceover', 15);
    if (!(await exists(speechPath))) {
        const speech = await createSpeech(settings.script, settings.voiceId);
        await saveJson(dir, 'alignment.json', speech.alignment);
        await fs.writeFile(`${speechPath}.tmp`, speech.audio);
        await fs.rename(`${speechPath}.tmp`, speechPath);
    }
    const speechInfo = await probe(speechPath);
    if (Number(speechInfo.format.duration) > draft.input.duration - 0.25) throw problem(400, 'This voiceover is too long. Shorten the script and generate a new ad.');
    const alignment = await readJson(dir, 'alignment.json');
    let music = null;
    if (settings.music) {
        await update('Generating soundtrack', 30);
        const rawPath = path.join(dir, 'music-original.mp3');
        if (!(await exists(rawPath))) {
            let task;
            if (await exists(path.join(dir, 'music-task.json'))) task = await readJson(dir, 'music-task.json');
            else {
                task = { id: await startMusic(settings.mood) };
                await saveJson(dir, 'music-task.json', task);
            }
            await fs.writeFile(rawPath, await waitForMusic(task.id));
        }
        const musicPath = path.join(dir, 'music.mp3');
        await prepareMusic(rawPath, musicPath, draft.input.duration);
        music = { dataUrl: `data:audio/mpeg;base64,${(await fs.readFile(musicPath)).toString('base64')}`, beats: [] };
    }
    await update('Rendering your ad', 45);
    const narration = `data:audio/mpeg;base64,${(await fs.readFile(speechPath)).toString('base64')}`;
    const video = await inChromeQueue(() => renderLaunchVideo({
        plan: draft.plan, source: draft.source, format: draft.input.format, music, sfx: {},
        narration, captions: settings.captions ? captionsFromAlignment(alignment) : [],
        onProgress: p => { void update('Rendering your ad', 45 + Math.round(p * 48)); },
    }));
    try {
        await update('Checking export', 96);
        const seconds = await finalizeExport(video.outputPath, path.join(dir, 'ad.mp4'), draft.input.duration);
        await fs.copyFile(video.posterPath, path.join(dir, 'poster.jpg'));
        return { seconds, width: video.width, height: video.height };
    } finally {
        await fs.unlink(video.outputPath).catch(() => {});
        await fs.unlink(video.posterPath).catch(() => {});
    }
}

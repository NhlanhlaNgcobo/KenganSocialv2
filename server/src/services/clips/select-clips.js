import { findClips } from './find-clips.js';

/** Prefer transcript selection for long speech videos; retain visual analysis as a fallback. */
export async function selectClipMoments(input, analyzeSignals, find = findClips) {
    const transcriptFirst = input.duration >= 600 && input.words.length >= 40;
    const selection = transcriptFirst ? await find({ ...input, signalClips: [] }) : null;
    if (selection?.finder === 'ai') return selection;
    const signalClips = await analyzeSignals();
    // Do not repeat an AI request that already failed before the visual fallback.
    return find({ ...input, signalClips }, selection ? { configured: () => false } : {});
}

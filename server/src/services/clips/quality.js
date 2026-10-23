/** Scores describe editorial preference, never a probability of going viral. */
export function editorialScore(scores, hasTrendEvidence) {
    const weights = hasTrendEvidence ? { hook: .35, flow: .25, value: .25, trend: .15 } : { hook: .4, flow: .3, value: .3 };
    return Math.round(Object.entries(weights).reduce((sum, [key, weight]) => sum + scores[key] * weight, 0));
}

/** Preserve every sentence; overlap lets stories cross chunk boundaries. */
export function transcriptChunks(sentences, maxChars = 30000, overlapSeconds = 120) {
    const chunks = [];
    let start = 0;
    while (start < sentences.length) {
        let end = start;
        let size = 0;
        while (end < sentences.length && (end === start || size + sentences[end].text.length + 40 <= maxChars)) {
            size += sentences[end].text.length + 40;
            end++;
        }
        chunks.push(sentences.slice(start, end));
        if (end === sentences.length) break;
        let next = end;
        while (next > start + 1 && sentences[next - 1].start >= sentences[end - 1].end - overlapSeconds) next--;
        start = Math.max(start + 1, next);
    }
    return chunks;
}

/** Existing face activity is supporting evidence, not semantic visual understanding. */
export function footageSignals(footage, windowSeconds = 20) {
    const bins = new Map();
    for (const sample of footage?.faceTrack?.samples || []) {
        const start = Math.floor(sample.t / windowSeconds) * windowSeconds;
        const row = bins.get(start) || { samples: 0, activity: 0, faces: 0 };
        row.samples++;
        row.faces += sample.faces?.length ? 1 : 0;
        row.activity += Math.max(0, ...(sample.faces || []).map(f => Number(f.act) || 0));
        bins.set(start, row);
    }
    return [...bins].map(([startSec, row]) => ({ startSec,
        endSec: Math.min(footage.durationSec, startSec + windowSeconds),
        score: row.activity / row.samples + .1 * row.faces / row.samples,
        reason: 'visible faces and measured mouth activity',
    })).filter(row => row.score > 0 && row.endSec > row.startSec);
}

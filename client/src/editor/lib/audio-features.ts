/**
 * Browser-side audio features for the lyric visualizer: a loudness envelope
 * and a rough tempo, decoded with the Web Audio API.
 */

export interface AudioFeatures {
    duration: number;
    /** Estimated tempo, or null when no steady pulse was found. */
    bpm: number | null;
    /** Mean loudness, 0..1 relative to the loudest frame. */
    averageEnergy: number;
    /** Normalised RMS loudness sampled `envelopeRate` times per second. */
    envelope: Float32Array;
    envelopeRate: number;
}

const ENVELOPE_RATE = 30;

export async function analyzeAudioBlob(blob: Blob): Promise<AudioFeatures> {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new Error('This browser cannot decode audio.');

    const context = new Ctor();
    try {
        const buffer = await context.decodeAudioData(await blob.arrayBuffer());
        const envelope = computeEnvelope(buffer, ENVELOPE_RATE);
        const averageEnergy = envelope.reduce((sum, value) => sum + value, 0) / Math.max(1, envelope.length);
        return { duration: buffer.duration, bpm: estimateBpm(envelope, ENVELOPE_RATE), averageEnergy, envelope, envelopeRate: ENVELOPE_RATE };
    } finally {
        void context.close();
    }
}

function computeEnvelope(buffer: AudioBuffer, rate: number) {
    const frameSize = Math.max(1, Math.floor(buffer.sampleRate / rate));
    const frames = Math.floor(buffer.length / frameSize);
    const envelope = new Float32Array(frames);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));

    let peak = 0;
    for (let frame = 0; frame < frames; frame += 1) {
        let sum = 0;
        const offset = frame * frameSize;
        for (let sample = 0; sample < frameSize; sample += 1) {
            let mixed = 0;
            for (const channel of channels) mixed += channel[offset + sample];
            mixed /= channels.length;
            sum += mixed * mixed;
        }
        const rms = Math.sqrt(sum / frameSize);
        envelope[frame] = rms;
        peak = Math.max(peak, rms);
    }
    if (peak > 0) for (let frame = 0; frame < frames; frame += 1) envelope[frame] /= peak;
    return envelope;
}

/** Autocorrelates onsets over 70–180 BPM. Good enough to drive pulse animations. */
function estimateBpm(envelope: Float32Array, rate: number) {
    if (envelope.length < rate * 8) return null;
    const onsets = new Float32Array(envelope.length);
    for (let i = 1; i < envelope.length; i += 1) onsets[i] = Math.max(0, envelope[i] - envelope[i - 1]);

    const minLag = Math.floor((60 / 180) * rate);
    const maxLag = Math.ceil((60 / 70) * rate);
    let bestLag = 0;
    let bestScore = 0;
    for (let lag = minLag; lag <= maxLag; lag += 1) {
        let score = 0;
        for (let i = lag; i < onsets.length; i += 1) score += onsets[i] * onsets[i - lag];
        if (score > bestScore) {
            bestScore = score;
            bestLag = lag;
        }
    }
    return bestLag ? Math.round((60 * rate) / bestLag) : null;
}

export function sampleEnvelope(features: AudioFeatures | null, songTime: number) {
    if (!features || !features.envelope.length) return 0;
    const index = Math.min(features.envelope.length - 1, Math.max(0, Math.floor(songTime * features.envelopeRate)));
    return features.envelope[index];
}

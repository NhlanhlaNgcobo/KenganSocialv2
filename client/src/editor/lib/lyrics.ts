/**
 * Lyric analysis model returned by POST /api/lyrics/analyze
 * (server/src/services/lyrics). Timestamps are seconds of *song* time.
 */

export const LYRIC_STYLES = ['karaoke', 'kinetic', 'spotlight'] as const;
export type LyricStyle = (typeof LYRIC_STYLES)[number];

export type LyricSection = 'intro' | 'verse' | 'pre-chorus' | 'chorus' | 'bridge' | 'hook' | 'outro';
export type LyricMood = 'hype' | 'uplifting' | 'romantic' | 'melancholic' | 'aggressive' | 'chill';

export interface LyricWord {
    text: string;
    start: number;
    end: number;
}

export interface LyricLine {
    id: string;
    text: string;
    start: number;
    end: number;
    words: LyricWord[];
    section: LyricSection;
    emphasis: string[];
}

export interface LyricAnalysis {
    lines: LyricLine[];
    mood: LyricMood;
    keywords: string[];
    suggestedStyle: LyricStyle;
    timingSource: 'whisper' | 'audio-model' | 'lrc' | 'estimated';
    analysisSource: 'claude' | 'heuristic';
}

export const TIMING_LABELS: Record<LyricAnalysis['timingSource'], string> = {
    whisper: 'Synced from audio',
    'audio-model': 'AI-timed (approx.)',
    lrc: 'Synced from LRC',
    estimated: 'Estimated timing',
};

export function isLyricAnalysis(value: unknown): value is LyricAnalysis {
    const v = value as LyricAnalysis;
    return !!v && Array.isArray(v.lines) && typeof v.mood === 'string' && LYRIC_STYLES.includes(v.suggestedStyle);
}

export const cleanWord = (word: string) => word.toLowerCase().replace(/[^a-z0-9']/g, '');

export function isEmphasized(line: LyricLine, word: string) {
    const cleaned = cleanWord(word);
    return cleaned.length > 0 && line.emphasis.some((item) => cleanWord(item) === cleaned);
}

/** Index of the line being sung at `songTime`, or -1 between lines. Lines are sorted by start. */
export function findActiveLineIndex(lines: LyricLine[], songTime: number) {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (lines[index].start <= songTime) {
            return songTime <= lines[index].end + 0.35 ? index : -1;
        }
    }
    return -1;
}

/** Shifts every timestamp, for when estimated timings run early or late. */
export function shiftAnalysis(analysis: LyricAnalysis, deltaSec: number): LyricAnalysis {
    const shift = (value: number) => Math.max(0, value + deltaSec);
    return {
        ...analysis,
        lines: analysis.lines.map((line) => ({
            ...line,
            start: shift(line.start),
            end: shift(line.end),
            words: line.words.map((word) => ({ ...word, start: shift(word.start), end: shift(word.end) })),
        })),
    };
}

function srtTimestamp(totalSeconds: number) {
    const ms = Math.max(0, Math.round(totalSeconds * 1000));
    const pad = (value: number, size = 2) => String(value).padStart(size, '0');
    return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

/** SRT of lines already mapped to timeline time. */
export function toSrt(lines: { text: string; start: number; end: number }[]) {
    return lines
        .filter((line) => line.end > 0)
        .map((line, index) => [index + 1, `${srtTimestamp(line.start)} --> ${srtTimestamp(line.end)}`, line.text, ''].join('\n'))
        .join('\n');
}

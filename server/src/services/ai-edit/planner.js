import { footageSignals } from '../clips/quality.js';
import { generateJson } from '../gemini-json.js';
import { findClips } from '../clips/find-clips.js';
import { buildSentences, transcriptForPrompt } from '../clips/transcript.js';
import { sanitizeGrade } from './profile.js';

/**
 * AI Edit planner: raw footage + editing-style profile → edit decisions for the editor timeline.
 *
 *  1. Jump cuts: speech is kept, pauses longer than the style allows (and filler words) are cut.
 *  2. Highlights mode keeps only the strongest moment of the requested length (clip finder).
 *  3. One AI pass writes the hook title, picks a cold-open quote and keyword callouts.
 *  4. Punch-ins alternate zoom levels at the style's rhythm, aimed at whoever is talking
 *     (face track with mouth activity), and reframe wide footage for vertical output.
 *  5. Captions follow the style (words per caption, case, colours, position, animation).
 *  6. The grade moves the footage's colour statistics towards the reference's.
 *
 * All times in the plan are seconds. Piece positions (x, y) are canvas pixels from centre, scale is
 * relative to the clip fitted to the canvas, matching the editor's ClipTransform.
 */

export const CANVAS = { '9:16': { width: 1080, height: 1920 }, '16:9': { width: 1920, height: 1080 }, '1:1': { width: 1080, height: 1080 } };

const FILLER = /^(um+|uh+|uhm+|erm+|er|ah+|hmm+|mm+|mhm)[,.!?…]*$/i;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r2 = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------
// 1. Cuts
// ---------------------------------------------------------------------------

/** Spoken ranges of the source, cut wherever a pause runs longer than maxPause. */
export function speechSegments(words, duration, { maxPause, removeFillers, removeSilence }) {
    const kept = removeFillers ? words.filter((w) => !FILLER.test(w.text)) : words;
    if (kept.length < 3) return [{ start: 0, end: duration }];
    const LEAD = 0.1;
    const TAIL = 0.16;
    if (!removeSilence) return [{ start: Math.max(0, kept[0].start - LEAD), end: Math.min(duration, kept[kept.length - 1].end + TAIL + 0.3) }];
    const segments = [];
    let start = Math.max(0, kept[0].start - LEAD);
    let last = kept[0];
    for (let i = 1; i < kept.length; i += 1) {
        const w = kept[i];
        if (w.start - last.end > maxPause) {
            segments.push({ start, end: Math.min(duration, last.end + Math.min(TAIL, maxPause / 2 + 0.06)) });
            start = Math.max(0, w.start - Math.min(LEAD, maxPause / 2));
        }
        last = w;
    }
    segments.push({ start, end: Math.min(duration, last.end + TAIL) });
    // Join pieces separated by a sliver; drop crumbs.
    const merged = [];
    for (const s of segments) {
        const prev = merged[merged.length - 1];
        if (prev && s.start - prev.end < 0.08) prev.end = s.end;
        else merged.push({ ...s });
    }
    return merged.filter((s) => s.end - s.start >= 0.35);
}

function intersect(segments, window) {
    return segments
        .map((s) => ({ start: Math.max(s.start, window.start), end: Math.min(s.end, window.end) }))
        .filter((s) => s.end - s.start >= 0.3);
}

// ---------------------------------------------------------------------------
// 3. Editorial AI pass
// ---------------------------------------------------------------------------

async function editorial({ sentences, duration, wantHook, wantColdOpen, calloutCount, style }) {
    if (!sentences.length || (!wantHook && !wantColdOpen && !calloutCount)) return {};
    const prompt = `You are the editor of a ${style}. Below is the timestamped transcript of the raw footage ("[start-end] sentence", seconds; ${Math.round(duration)}s long).

Return ONLY JSON:
{
  "hookTitle": ${wantHook ? '"on-screen title for the first 3 seconds: max 7 words, specific to this video, makes a stranger keep watching (a bold claim or question from the content, never clickbait that the video does not pay off)"' : 'null'},
  "coldOpen": ${wantColdOpen ? '{"start": seconds, "end": seconds} — the single most gripping 6–14 second quote to show before the intro (start on the first word of a sentence, end when the thought lands), or null' : 'null'},
  "callouts": ${calloutCount ? `[ up to ${calloutCount} items: {"time": seconds when the phrase is spoken, "text": "1–4 word on-screen callout (a number, key term or punchline from that moment)"} ]` : '[]'}
}

TRANSCRIPT:
${transcriptForPrompt(sentences)}`;
    try {
        return (await generateJson([{ text: prompt }], { temperature: 0.5 })) || {};
    } catch (error) {
        console.warn('[AI Edit] Editorial pass fell back:', error.message);
        return {};
    }
}

/** Without the AI: the opening sentence becomes the hook, numbers become callouts. */
function editorialFallback(sentences, wantHook, calloutCount) {
    const hook = wantHook && sentences[0] ? sentences[0].text.split(' ').slice(0, 7).join(' ').replace(/[,.;:]$/, '') : null;
    const callouts = [];
    for (const s of sentences) {
        if (callouts.length >= calloutCount) break;
        const m = s.text.match(/(R|\$|€|£)?\d[\d,.]*\s?(%|k|K|million|billion|percent|times|x)?/);
        if (m && m[0].length >= 2) callouts.push({ time: s.start + 0.2, text: m[0].trim() });
    }
    return { hookTitle: hook, coldOpen: null, callouts };
}

// ---------------------------------------------------------------------------
// 4. Framing
// ---------------------------------------------------------------------------

/**
 * Who to frame in a source range: the most active face (talking), else the face nearest `hintCx`
 * (where the re-framing step found the focus), else the biggest.
 */
function subjectIn(track, start, end, hintCx = null) {
    const samples = (track?.samples || []).filter((s) => s.t >= start && s.t <= end && s.faces.length);
    if (!samples.length) return null;
    const clusters = [];
    for (const s of samples) {
        for (const f of s.faces) {
            let c = clusters.find((k) => Math.abs(k.cx - f.cx) < 0.09 && Math.abs(k.cy - f.cy) < 0.12);
            if (!c) {
                c = { cx: f.cx, cy: f.cy, xs: [], ys: [], hs: [], act: 0, n: 0, area: 0 };
                clusters.push(c);
            }
            c.xs.push(f.cx);
            c.ys.push(f.cy);
            c.hs.push(f.h);
            c.act += f.act;
            c.n += 1;
            c.area += f.w * f.h;
        }
    }
    const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    for (const c of clusters) {
        c.cx = median(c.xs);
        c.cy = median(c.ys);
        c.h = median(c.hs);
        c.presence = c.n / samples.length;
        c.meanAct = c.act / c.n;
    }
    const present = clusters.filter((c) => c.presence >= 0.3);
    if (!present.length) return null;
    present.sort((a, b) => b.meanAct - a.meanAct);
    const talking = present.length > 1 && present[0].meanAct > present[1].meanAct * 1.35 ? present[0] : null;
    const hinted = hintCx == null ? null : [...present].sort((a, b) => Math.abs(a.cx - hintCx) - Math.abs(b.cx - hintCx))[0];
    const subject = talking || hinted || present.sort((a, b) => b.area - a.area)[0];
    return { cx: subject.cx, cy: subject.cy, h: subject.h, speakers: present.length };
}

/**
 * Clip transform that puts the subject in frame at `zoom` (on top of the scale that fills the
 * canvas). Offsets never reveal the background.
 */
function frameFor(subject, zoom, src, canvas) {
    const fit = Math.min(canvas.width / src.width, canvas.height / src.height);
    const cover = Math.max(canvas.width / src.width, canvas.height / src.height) / fit;
    const scale = cover * zoom;
    const dispW = src.width * fit * scale;
    const dispH = src.height * fit * scale;
    const maxX = Math.max(0, (dispW - canvas.width) / 2);
    const maxY = Math.max(0, (dispH - canvas.height) / 2);
    if (!subject) return { scale: r2(scale), x: 0, y: 0 };
    // Face centred horizontally, eyes a little above the middle.
    const x = clamp(-(subject.cx - 0.5) * dispW, -maxX, maxX);
    const y = clamp((0.42 - 0.5) * canvas.height - (subject.cy - 0.5) * dispH, -maxY, maxY);
    return { scale: r2(scale), x: Math.round(x), y: Math.round(y) };
}

/** Focus move (share of the source width) that needs a new crop, and how long it must last. */
const REFRAME_SHIFT = 0.1;
const REFRAME_HOLD = 1.2;
const REFRAME_MIN_PIECE = 1.5;

/**
 * Splits [start, end] where the framing has to move: the talking face changes, or the subject moves
 * well away from where the crop is. One fixed crop per piece otherwise framed an empty table when a
 * conversation switched speakers inside an 11-second piece. Splits land on word ends.
 * @returns {{ start: number, end: number, focusCx: number | null }[]}
 */
export function reframeSpans(track, start, end, words) {
    const samples = (track?.samples || []).filter((s) => s.t >= start && s.t <= end && s.faces.length);
    if (samples.length < 6 || end - start < 2 * REFRAME_MIN_PIECE) return [{ start, end, focusCx: null }];
    const spans = [];
    let focus = null;
    let anchor = null;
    let spanStart = start;
    let pending = null;
    for (const s of samples) {
        const byAct = [...s.faces].sort((a, b) => b.act - a.act);
        const clear = byAct.length === 1 || byAct[0].act > byAct[1].act * 1.6 ? byAct[0] : null;
        const nearest = focus == null ? [...s.faces].sort((a, b) => b.w * b.h - a.w * a.h)[0] : s.faces.reduce((best, f) => (Math.abs(f.cx - focus) < Math.abs(best.cx - focus) ? f : best));
        const lead = clear || nearest;
        focus = focus == null ? lead.cx : 0.5 * focus + 0.5 * lead.cx;
        if (anchor == null) {
            anchor = focus;
            continue;
        }
        if (Math.abs(focus - anchor) <= REFRAME_SHIFT) {
            pending = null;
            continue;
        }
        pending ??= s.t;
        if (s.t - pending < REFRAME_HOLD) continue;
        // Cut at the word end nearest the moment the focus started to move.
        const near = words.filter((w) => w.end > pending - 0.8 && w.end < pending + 0.8);
        const cut = near.length ? near.reduce((best, w) => (Math.abs(w.end - pending) < Math.abs(best - pending) ? w.end : best), near[0].end) : pending;
        if (cut - spanStart >= REFRAME_MIN_PIECE && end - cut >= REFRAME_MIN_PIECE) {
            spans.push({ start: spanStart, end: cut, focusCx: anchor });
            spanStart = cut;
        }
        anchor = focus;
        pending = null;
    }
    spans.push({ start: spanStart, end, focusCx: anchor });
    return spans;
}

// ---------------------------------------------------------------------------
// 6. Grade
// ---------------------------------------------------------------------------

/** Grade that moves footage colour statistics towards the reference's. */
export function matchGrade(reference, footage) {
    if (!reference || !footage) return null;
    if (reference.saturation < 0.06) return sanitizeGrade({ saturation: 0, contrast: clamp(reference.contrast / Math.max(footage.contrast, 0.05), 0.8, 1.4) });
    return sanitizeGrade({
        saturation: clamp(reference.saturation / Math.max(footage.saturation, 0.05), 0.65, 1.6),
        contrast: clamp(reference.contrast / Math.max(footage.contrast, 0.05), 0.8, 1.4),
        brightness: clamp((reference.brightness - footage.brightness) * 0.8, -0.12, 0.12),
        temperature: clamp((reference.warmth - footage.warmth) * 6, -0.8, 0.8),
    });
}

// ---------------------------------------------------------------------------
// Captions and titles
// ---------------------------------------------------------------------------

function phrases(words, maxWords) {
    const out = [];
    let cur = null;
    for (const w of words) {
        const text = String(w.text || '').trim();
        if (!text) continue;
        const brk = !cur || cur.words.length >= maxWords || w.start - cur.end > 0.6 || /[.!?]$/.test(cur.words[cur.words.length - 1]);
        if (brk) {
            if (cur) out.push(cur);
            cur = { words: [text], start: w.start, end: w.end };
        } else {
            cur.words.push(text);
            cur.end = w.end;
        }
    }
    if (cur) out.push(cur);
    return out;
}

const readableOn = (hex) => {
    const n = parseInt(String(hex || '#000000').slice(1), 16);
    const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return l > 0.6 ? '#111111' : '#ffffff';
};

/** TextElement style for captions in this profile, sized for the canvas. */
export function captionStyle(captions, canvas) {
    const fontSize = Math.round(clamp(captions.size * canvas.height / 0.72, 28, canvas.height * 0.09));
    return {
        fontSize,
        fontFamily: captions.font,
        fontWeight: 'bold',
        color: captions.color,
        backgroundColor: captions.background ? 'rgba(0,0,0,0.62)' : 'transparent',
        strokeColor: captions.outline ? '#000000' : 'transparent',
        strokeWidth: captions.outline ? Math.max(2, Math.round(fontSize * 0.09)) : 0,
        textAlign: 'center',
        animation: captions.animation,
        y: Math.round((captions.y - 0.5) * canvas.height),
    };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * @param {object} input
 * @param {Array<{text,start,end}>} input.words  transcript, seconds
 * @param {object} input.footage                  python /process/analyze-footage result
 * @param {object} input.profile                  editing style (profile.js)
 * @param {object} input.options                  user choices
 */
export async function planEdit({ words, footage, profile, options, trendContext = [] }) {
    const duration = footage.durationSec;
    const ratio = options.ratio === 'auto' ? profile.format.ratio : options.ratio;
    const canvas = CANVAS[ratio] || CANVAS['9:16'];
    const src = { width: footage.width || canvas.width, height: footage.height || canvas.height };
    const hasSpeech = words.length >= 12;

    // 1–2. Cuts and highlight window.
    let segments = hasSpeech
        ? speechSegments(words, duration, { maxPause: profile.pacing.maxPauseSec, removeFillers: options.removeFillers, removeSilence: options.removeSilence })
        : [{ start: 0, end: duration }];
    let highlight = null;
    if (options.mode === 'highlights' && hasSpeech && duration > options.targetSeconds * 1.3) {
        // Pause cuts shorten the moment, so ask for a slightly longer window than the target.
        const pauseShare = profile.pacing.maxPauseSec < 0.3 ? 1.3 : 1.15;
        const range = { min: Math.round(options.targetSeconds * 0.95 * pauseShare), max: Math.round(options.targetSeconds * 1.25 * pauseShare) };
        const found = await findClips({ words, duration, signalClips: footageSignals(footage), trendContext, count: 1, length: 'medium', prompt: options.focus || '', range });
        const best = found.clips[0];
        if (best) {
            highlight = { start: best.start, end: best.end, title: best.title, hook: best.hook, finder: found.finder, note: found.note, score: best.score };
            segments = intersect(segments, highlight);
        }
    }
    const spokenWords = words.filter((w) => segments.some((s) => w.start >= s.start - 0.05 && w.start < s.end));
    const sentences = buildSentences(spokenWords);

    // 3. Editorial pass (one AI call: hook, cold open, callouts).
    const outputGuess = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
    const calloutCount = options.callouts && profile.callouts.enabled !== false ? Math.min(12, Math.max(1, Math.round((outputGuess / 60) * (profile.callouts.perMinute || 1)))) : 0;
    const wantColdOpen = options.hook && profile.hook.coldOpen && options.mode === 'full' && duration > 90;
    const styleName = `${ratio === '16:9' ? 'long-form YouTube video' : 'short-form vertical video'} in this style: ${profile.summary || profile.name}`;
    let edit = hasSpeech ? await editorial({ sentences, duration, wantHook: options.hook, wantColdOpen, calloutCount, style: styleName }) : {};
    if (!edit.hookTitle && !edit.callouts?.length) edit = { ...editorialFallback(sentences, options.hook, calloutCount), ...edit };
    // The editorial title is written as a hook; the clip finder's "hook" is the opening line spoken.
    const hookTitle = options.hook ? String(edit.hookTitle || highlight?.title || '').replace(/\s+/g, ' ').trim().slice(0, 70) : '';

    // Cold open: the chosen quote's speech, played first.
    let coldOpen = [];
    const co = edit.coldOpen;
    if (wantColdOpen && co && Number(co.end) - Number(co.start) >= 4 && Number(co.end) - Number(co.start) <= 20) {
        coldOpen = intersect(segments, { start: Number(co.start), end: Number(co.end) });
    }

    // Pieces in output order.
    const pieces = [];
    let cursor = 0;
    for (const [list, label] of [[coldOpen, 'Cold open'], [segments, 'Keep']]) {
        for (const s of list) {
            pieces.push({ srcStart: s.start, srcEnd: s.end, outStart: cursor, label });
            cursor += s.end - s.start;
        }
    }
    const outDuration = cursor;

    // Source time → output time (first occurrence; cold-open words also appear later).
    const toOut = (t) => {
        for (const p of pieces) if (t >= p.srcStart && t < p.srcEnd) return p.outStart + (t - p.srcStart);
        return null;
    };
    const callouts = (Array.isArray(edit.callouts) ? edit.callouts : [])
        .map((c) => ({ text: String(c?.text || '').replace(/\s+/g, ' ').trim().slice(0, 32), at: toOut(Number(c?.time)) }))
        .filter((c) => c.text && c.at != null && c.at > 3)
        .sort((a, b) => a.at - b.at)
        .filter((c, i, list) => i === 0 || c.at - list[i - 1].at > 4)
        .slice(0, calloutCount);

    // 4. Punch-ins: split pieces on the beat (at word gaps) and alternate zoom levels.
    const beat = profile.zooms.punchIns && options.zooms && profile.zooms.perMinute > 0 ? clamp(60 / profile.zooms.perMinute, 2.5, 60) : null;
    const split = [];
    for (const p of pieces) {
        if (!beat || p.srcEnd - p.srcStart < beat * 1.5) {
            split.push(p);
            continue;
        }
        let from = p.srcStart;
        let out = p.outStart;
        const inside = words.filter((w) => w.end > p.srcStart && w.end < p.srcEnd);
        while (p.srcEnd - from >= beat * 1.5) {
            const target = from + beat;
            const boundary = inside.reduce((best, w) => (Math.abs(w.end - target) < Math.abs(best - target) && w.end > from + 1.2 ? w.end : best), target);
            split.push({ ...p, srcStart: from, srcEnd: boundary, outStart: out });
            out += boundary - from;
            from = boundary;
        }
        split.push({ ...p, srcStart: from, srcEnd: p.srcEnd, outStart: out });
    }

    // Re-frame inside a piece at the footage's own camera cuts (multi-camera recordings), and within a
    // shot when the speaker changes or the subject moves. The zoom level carries over.
    const sceneCuts = (footage.sceneCuts || []).filter((c) => Number.isFinite(c));
    const framed = split.flatMap((p) => {
        const edges = [p.srcStart, ...sceneCuts.filter((c) => c > p.srcStart + 0.4 && c < p.srcEnd - 0.4), p.srcEnd];
        const shots = edges.slice(1).map((end, i) => ({ start: edges[i], end }));
        return shots
            .flatMap((shot) => reframeSpans(footage.faceTrack, shot.start, shot.end, words))
            .map((s, i) => ({ ...p, srcStart: s.start, srcEnd: s.end, outStart: p.outStart + (s.start - p.srcStart), focusCx: s.focusCx, reframe: i > 0 }));
    });

    let zoomed = false;
    let punchIns = 0;
    let lastBeatAt = -Infinity;
    const finalPieces = framed.map((p, index) => {
        const callout = callouts.some((c) => c.at >= p.outStart - 0.2 && c.at < p.outStart + (p.srcEnd - p.srcStart));
        if (beat && !p.reframe && (p.outStart - lastBeatAt >= beat * 0.8 || callout)) {
            zoomed = callout ? true : index === 0 ? false : !zoomed;
            lastBeatAt = p.outStart;
        }
        if (!beat) zoomed = false;
        if (zoomed && !p.reframe) punchIns += 1;
        const subject = subjectIn(footage.faceTrack, p.srcStart, p.srcEnd, p.focusCx);
        const frame = frameFor(subject, zoomed ? 1 + profile.zooms.amount : 1, src, canvas);
        const slow = profile.zooms.slowZoom && options.zooms && !zoomed;
        return {
            srcStart: r2(p.srcStart),
            srcEnd: r2(p.srcEnd),
            outStart: r2(p.outStart),
            label: zoomed ? `${p.label} · punch-in` : p.label,
            transform: { scale: frame.scale, x: frame.x, y: frame.y, animation: slow ? 'zoom-in' : 'none', animationAmount: slow ? profile.zooms.amount : 0.2 },
            speakers: subject?.speakers || 0,
        };
    });

    // 5. Captions on the output timeline.
    const capStyle = captionStyle(profile.captions, canvas);
    const keywords = callouts.map((c) => c.text.toLowerCase());
    const captions = [];
    if (options.captions && hasSpeech) {
        const outWords = [];
        for (const p of finalPieces) {
            for (const w of words) {
                if (w.start >= p.srcStart - 0.02 && w.start < p.srcEnd && (!options.removeFillers || !FILLER.test(w.text))) {
                    outWords.push({ text: w.text, start: p.outStart + Math.max(0, w.start - p.srcStart), end: p.outStart + Math.min(p.srcEnd, w.end) - p.srcStart });
                }
            }
        }
        for (const ph of phrases(outWords, profile.captions.wordsPerCaption)) {
            let text = ph.words.join(' ');
            if (profile.captions.uppercase) text = text.toUpperCase().replace(/[.,;:]+(\s|$)/g, '$1').trim();
            const lower = text.toLowerCase();
            const emphasis = keywords.some((k) => k.split(' ').some((part) => part.length > 2 && lower.includes(part))) || /\d/.test(text);
            captions.push({ text, start: r2(ph.start), end: r2(Math.max(ph.end, ph.start + 0.25)), highlight: !!(emphasis && profile.captions.highlight) });
        }
        // Each caption holds until the next one starts (no flicker between words).
        for (let i = 0; i < captions.length - 1; i += 1) {
            const gap = captions[i + 1].start - captions[i].end;
            if (gap > 0 && gap < 0.5) captions[i].end = captions[i + 1].start;
        }
    }

    // Titles: hook and callouts.
    const accent = profile.captions.highlight || '#facc15';
    const titles = [];
    if (hookTitle) {
        const vertical = ratio !== '16:9';
        const fontSize = Math.round(canvas.height * (vertical ? 0.036 : 0.06));
        titles.push({
            role: 'hook',
            content: vertical ? wrap(hookTitle, 18) : wrap(hookTitle, 30),
            start: 0,
            end: r2(Math.min(outDuration, Math.max(2.8, coldOpen.length ? coldOpen.reduce((s, c) => s + c.end - c.start, 0) : 3))),
            fontSize,
            fontFamily: profile.captions.font === 'Inter' ? 'Poppins' : profile.captions.font,
            color: readableOn(accent),
            backgroundColor: accent,
            strokeColor: 'transparent',
            strokeWidth: 0,
            y: Math.round(canvas.height * (vertical ? -0.3 : -0.3)),
            animation: 'pop',
        });
    }
    for (const c of callouts) {
        titles.push({
            role: 'callout',
            content: profile.captions.uppercase ? c.text.toUpperCase() : c.text,
            start: r2(c.at),
            end: r2(Math.min(outDuration, c.at + 1.8)),
            fontSize: Math.round(canvas.height * (ratio === '16:9' ? 0.07 : 0.042)),
            fontFamily: 'Anton',
            color: readableOn(accent),
            backgroundColor: accent,
            strokeColor: 'transparent',
            strokeWidth: 0,
            y: Math.round(canvas.height * (ratio === '16:9' ? -0.32 : -0.24)),
            animation: 'pop',
        });
    }

    // 6. Grade.
    const grade = options.colorMatch
        ? profile.color.stats
            ? matchGrade(profile.color.stats, footage.color)
            : profile.color.target
              ? sanitizeGrade(profile.color.target)
              : null
        : null;

    const removed = duration - segments.reduce((sum, s) => sum + (s.end - s.start), 0);
    return {
        ratio,
        canvas,
        sourceDuration: r2(duration),
        duration: r2(outDuration),
        pieces: finalPieces,
        captions: { style: capStyle, highlightColor: profile.captions.highlight, items: captions },
        titles,
        grade,
        highlight,
        summary: {
            cuts: Math.max(0, segments.length - 1),
            removedSec: r2(Math.max(0, removed)),
            punchIns,
            captions: captions.length,
            callouts: callouts.length,
            hookTitle: hookTitle || null,
            coldOpenSec: r2(coldOpen.reduce((s, c) => s + c.end - c.start, 0)),
            // Faces present across the footage; a per-piece maximum overcounts people who move.
            speakers: subjectIn(footage.faceTrack, 0, duration)?.speakers || Math.max(0, ...finalPieces.map((p) => p.speakers)),
            graded: !!grade,
        },
    };
}

/** Wraps a title onto lines of about `width` characters. */
function wrap(text, width) {
    const lines = [];
    let line = '';
    for (const word of text.split(' ')) {
        if (line && (line + ' ' + word).length > width) {
            lines.push(line);
            line = word;
        } else {
            line = line ? `${line} ${word}` : word;
        }
    }
    if (line) lines.push(line);
    return lines.slice(0, 3).join('\n');
}

/** Deterministic caption animation shared by playback, scrubbing and ASS export. */
export const CAPTION_MOTIONS = [
    'pulse-word', 'marker-sweep', 'kinetic-stack', 'quiet-reveal', 'receipt-proof',
    'dialogue-cards', 'type-on-note', 'bounce-pair', 'focus-keyword', 'underline-flow',
];

export const TEXT_ANIMATIONS = [
    ['title-rise', 'Rise into frame'], ['title-drop', 'Drop into place'],
    ['title-grow', 'Grow from centre'], ['title-recede', 'Settle from close'],
    ['title-bounce', 'Spring title'], ['title-drift', 'Floating title'],
    ['title-type', 'Typewriter title'], ['title-steps', 'Word steps'],
    ['title-stack', 'Stacked reveal'], ['title-breathe', 'Breathing title'],
].map(([id, label]) => ({ id, label }));

/** Preserve genuine timestamps when text still matches; edited text uses explicit even timing. */
export function captionTokens(content, words, duration) {
    const text = String(content).trim().split(/\s+/).filter(Boolean);
    const sameWords = Array.isArray(words) && words.length === text.length && words.every((w, i) =>
        String(w.text).toLowerCase().replace(/[.,;:!?]/g, '') === text[i].toLowerCase().replace(/[.,;:!?]/g, ''));
    return text.map((word, i) => ({
        text: word,
        start: sameWords ? Math.max(0, Number(words[i].start) || 0) : i * duration / Math.max(1, text.length),
        end: sameWords ? Math.max(0, Number(words[i].end) || 0) : (i + 1) * duration / Math.max(1, text.length),
    }));
}

export function captionFrame(content, words, motion, localTime, duration, color = '#ffffff', accent = '#a3e635') {
    const time = Math.max(0, localTime);
    if (TEXT_ANIMATIONS.some((a) => a.id === motion)) {
        const p = Math.min(1, time / 0.6);
        const ease = 1 - Math.pow(1 - p, 3);
        const tokens = String(content).split(/\s+/).filter(Boolean);
        const letters = Array.from(String(content));
        const type = motion === 'title-type';
        const chars = Math.floor(letters.length * Math.min(1, time / Math.min(2, duration * 0.7)));
        const chunks = type ? [{ text: letters.slice(0, chars).join(''), tail: letters.slice(chars).join(''), color, opacity: 1 }] : tokens.map((text, i) => ({
            text, color, opacity: ['title-steps', 'title-stack'].includes(motion) && time < i * Math.min(0.15, duration / Math.max(1, tokens.length)) ? 0 : 1,
            breakAfter: motion === 'title-stack' && i < tokens.length - 1,
        }));
        const scale = motion === 'title-grow' ? 0.5 + ease * 0.5 : motion === 'title-recede' ? 1.6 - ease * 0.6
            : motion === 'title-bounce' ? 1 - 0.3 * Math.exp(-p * 7) * Math.cos(p * 12)
            : motion === 'title-breathe' ? 1 + 0.035 * Math.sin(time * 2.5) : 1;
        const y = motion === 'title-rise' ? 70 * (1 - ease) : motion === 'title-drop' ? -70 * (1 - ease)
            : motion === 'title-drift' ? -12 * Math.sin(time * 2) : 0;
        return { chunks, scale, y, opacity: Math.min(1, time / 0.15) };
    }
    const tokens = captionTokens(content, words, Math.max(0.05, duration));
    let active = -1;
    tokens.forEach((w, i) => { if (time >= w.start && time < w.end) active = i; });
    const wordAge = active < 0 ? 1 : time - tokens[active].start;
    const settle = Math.max(0, 1 - wordAge / 0.18);
    const keyword = Math.max(0, tokens.findIndex((w) => /[\d%$£€]|^R\d/i.test(w.text)));
    const chunks = tokens.map((w, i) => {
        const current = active === i;
        const spoken = time >= w.start;
        const revealMode = ['kinetic-stack', 'quiet-reveal', 'bounce-pair'].includes(motion);
        let text = w.text;
        let tail = '';
        if (motion === 'type-on-note') {
            const fraction = Math.min(1, Math.max(0, (time - w.start) / Math.max(0.04, w.end - w.start)));
            const chars = Math.floor(fraction * Array.from(text).length);
            const letters = Array.from(text);
            tail = letters.slice(chars).join('');
            text = letters.slice(0, chars).join('');
        }
        const emphasis = motion === 'receipt-proof' ? i === keyword : motion === 'focus-keyword' ? current : current && ['pulse-word', 'marker-sweep', 'bounce-pair'].includes(motion);
        return {
            text, tail, color: emphasis ? accent : color,
            opacity: revealMode && !spoken ? 0 : 1,
            underline: (motion === 'underline-flow' || motion === 'marker-sweep') && current,
            breakAfter: motion === 'kinetic-stack' && i < tokens.length - 1 && i % 2 === 1,
        };
    });
    const scale = motion === 'pulse-word' ? 1 + 0.05 * settle
        : motion === 'bounce-pair' ? 1 + 0.08 * settle * Math.cos(wordAge * 35)
        : motion === 'focus-keyword' ? 1 + 0.035 * settle : 1;
    return {
        chunks, scale,
        y: motion === 'dialogue-cards' ? 18 * Math.max(0, 1 - time / 0.2) : 0,
        opacity: ['quiet-reveal', 'dialogue-cards'].includes(motion) ? Math.min(1, time / 0.12) : 1,
    };
}

/** Frame snapshots are coalesced so stable captions stay one ASS event, not 30 copies/sec. */
export function captionFrames(content, words, motion, duration, color, accent, fps = 30) {
    const frames = [];
    const step = 1 / fps;
    let key = '';
    for (let i = 0; i < Math.ceil(duration * fps); i++) {
        const start = i * step;
        const frame = captionFrame(content, words, motion, start, duration, color, accent);
        // Export rounds scale/position to avoid thousands of effectively identical events.
        frame.scale = Math.round(frame.scale * 1000) / 1000;
        frame.y = Math.round(frame.y * 10) / 10;
        const nextKey = JSON.stringify(frame);
        const end = Math.min(duration, (i + 1) * step);
        if (nextKey === key) frames[frames.length - 1].end = end;
        else { frames.push({ start, end, frame }); key = nextKey; }
    }
    return frames;
}

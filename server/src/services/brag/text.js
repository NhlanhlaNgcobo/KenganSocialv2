/** Text helpers for on-screen lines: short enough to read, never cut mid-phrase. */

/**
 * The first sentence of `text` if it has at most `max` words; otherwise the longest clean
 * clause (cut at a comma, dash, "and", "for", "with" or "to") that fits, or '' if none does.
 */
export function shortLine(text, max = 14) {
    const first = String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .split(/(?<=[.!?])\s/)[0]
        .trim();
    const words = first.split(' ').filter(Boolean);
    if (words.length <= max) return first;
    const head = words.slice(0, max).join(' ');
    // Every place the line could end, latest first; never inside a list ("routed, labeled, and
    // prioritized" or "TikTok, Reels and Shorts"), which reads as cut off.
    const positions = [];
    for (const c of [',', ' –', ' —', ' - ', ':', ' and ', ' for ', ' with ', ' to ', ' that ']) {
        for (let i = head.indexOf(c); i >= 0; i = head.indexOf(c, i + 1)) positions.push({ i, c });
    }
    const inList = ({ i, c }) => {
        const before = first.slice(0, i);
        const after = first.slice(i);
        if (c === ',') return /^,\s*(?:\S+\s){0,2}?\S+(?:,|\s(?:and|or|&)\s)/.test(after) || /^,\s*(?:and|or)\s/.test(after) || /,\s*(?:\S+\s){0,2}\S+$/.test(before);
        if (c === ' and ') return /,\s*(?:\S+\s){0,2}\S+$/.test(before);
        return false;
    };
    const cut = positions
        .filter((p) => p.i > 18 && !inList(p))
        .reduce((best, p) => Math.max(best, p.i), -1);
    if (cut <= 18) return '';
    let line = head.slice(0, cut).replace(/[,:–—-]\s*$/, '').trim();
    // "…for agencies: edit" — a stub of a few words after a colon or dash reads as cut off, so end
    // at the colon or dash instead.
    const clause = Math.max(line.lastIndexOf(':'), line.lastIndexOf(' –'), line.lastIndexOf(' —'), line.lastIndexOf(' - '));
    if (clause > 18 && line.slice(clause + 1).trim().split(' ').length <= 3) line = line.slice(0, clause).trim();
    return line;
}

/** A headline: up to `max` words, cut at a clause boundary when longer (or with an ellipsis as a last resort). */
export function headline(text, max = 8) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean.split(' ').length <= max) return clean;
    return shortLine(clean, max) || `${clean.split(' ').slice(0, max).join(' ')}…`;
}

/** A supporting line: kept whole (even two short sentences) when it fits in `max` words, else shortLine. */
export function sublineText(text, max = 16) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    return clean.split(' ').length <= max ? clean : shortLine(clean, max);
}

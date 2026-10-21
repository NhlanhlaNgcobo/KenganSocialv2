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
    const cuts = [',', ' –', ' —', ' - ', ':', ' and ', ' for ', ' with ', ' to ', ' that '].map((c) => head.lastIndexOf(c));
    const cut = Math.max(...cuts);
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

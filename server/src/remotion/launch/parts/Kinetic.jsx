import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { alpha, clamp, ease, expoOut, lightness, pop, toHex } from './motion.js';
import { useBeat } from './time.js';

/**
 * Kinetic type. Headlines arrive word by word in one of several styles (masked rise, slide,
 * punch, spring pop, calm fade); one key word is marked in the brand colour and kicks on the
 * music's beat. Lines can be forced with "\n" (the second line is set in a quieter colour).
 */

const FILLER = /^(the|a|an|and|or|to|of|in|on|for|with|your|you|is|it|that|this|at|by|from|be|are|we|our|my|into|one|every|all|no|not|more|less|its|their|how|what|get|just|than)$/i;

/** The word worth highlighting: the longest one that isn't filler (later words win ties). */
export function keyWordIndex(text) {
    const list = String(text || '').split(/\s+/);
    let best = -1;
    let bestLen = 0;
    list.forEach((w, i) => {
        const clean = w.replace(/[^\p{L}\p{N}]/gu, '');
        if (!clean || FILLER.test(clean)) return;
        if (clean.length >= bestLen) {
            best = i;
            bestLen = clean.length;
        }
    });
    return best;
}

/**
 * A font size that fits `text` in `maxWidth` on at most `maxLines` lines (rough metrics of a
 * bold sans), never above `maxSize` or below `minSize`.
 */
export function fitSize(text, maxWidth, { maxSize, minSize = 24, maxLines = 3, charWidth = 0.53 }) {
    const lines = String(text || '').split('\n');
    const longestLine = Math.max(...lines.map((l) => l.length), 1);
    const longestWord = Math.max(...String(text || '').split(/\s+/).map((w) => w.length), 1);
    const chars = Math.max(1, String(text || '').replace(/\n/g, ' ').length);
    // Forced lines each stay on one row; free text wraps over up to maxLines rows (with some slack for word breaks).
    const byLines = lines.length > 1 ? maxWidth / (longestLine * charWidth) : (maxWidth * maxLines * 0.84) / (chars * charWidth);
    const byWord = maxWidth / (longestWord * (charWidth + 0.08));
    return Math.round(Math.max(minSize, Math.min(maxSize, byLines, byWord)));
}

const near = (a, b) => Math.abs(lightness(a) - lightness(b)) < 0.18;
const chromatic = (c) => {
    const h = toHex(c);
    const ch = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    return Math.max(...ch) - Math.min(...ch) > 50;
};

function Word({ word, i, local, variant, fps, size, marked, markP, markStyle, accent, accentText, punch }) {
    let inner = {};
    let maskStyle = { display: 'inline-block', position: 'relative' };
    if (variant === 'rise' || variant === 'slide') {
        const p = ease(local, 0, 16, [0, 1], expoOut);
        maskStyle = { ...maskStyle, overflow: 'hidden', padding: '0.06em 0.14em 0.16em', margin: '-0.06em -0.14em -0.16em', verticalAlign: 'top' };
        inner = variant === 'rise' ? { transform: `translateY(${(1 - p) * 112}%) rotate(${(1 - p) * 4}deg)` } : { transform: `translateX(${(1 - p) * -105}%)`, opacity: interpolate(p, [0, 0.5], [0, 1], clamp) };
    } else if (variant === 'punch') {
        const p = ease(local, 0, 7, [0, 1], expoOut);
        inner = { transform: `scale(${2.1 - 1.1 * p})`, opacity: interpolate(p, [0, 0.35], [0, 1], clamp) };
    } else if (variant === 'fade') {
        const p = ease(local, 0, fps * 0.5);
        inner = { opacity: p, transform: `translateY(${(1 - p) * 0.25}em)` };
    } else {
        const p = pop(local, fps, 0, { damping: 13, stiffness: 170, mass: 0.6 });
        inner = { opacity: interpolate(p, [0, 0.4], [0, 1], clamp), transform: `translateY(${(1 - p) * 0.45}em) scale(${0.85 + 0.15 * p})` };
    }
    const kick = marked ? 1 + punch * 0.07 : 1;
    return (
        <span style={maskStyle}>
            <span style={{ display: 'inline-block', position: 'relative', isolation: 'isolate', ...inner }}>
                {marked && markStyle === 'marker' ? (
                    <span
                        style={{
                            position: 'absolute',
                            left: '-0.1em',
                            right: '-0.1em',
                            top: '0.1em',
                            bottom: '0.02em',
                            background: accent,
                            borderRadius: '0.12em',
                            transform: `scaleX(${markP})`,
                            transformOrigin: 'left center',
                            zIndex: -1,
                        }}
                    />
                ) : null}
                <span
                    style={{
                        display: 'inline-block',
                        transform: `scale(${kick})`,
                        color: marked ? (markStyle === 'marker' ? (markP > 0.5 ? accentText : undefined) : markP > 0 ? accent : undefined) : undefined,
                    }}
                >
                    {word}
                </span>
                {marked && markStyle === 'underline' ? (
                    <span style={{ position: 'absolute', left: 0, right: 0, bottom: '0.02em', height: Math.max(3, size * 0.07), background: accent, borderRadius: 99, transform: `scaleX(${markP})`, transformOrigin: 'left center' }} />
                ) : null}
            </span>
        </span>
    );
}

/**
 * @param {'rise'|'slide'|'punch'|'pop'|'fade'} variant
 * @param {'auto'|'marker'|'underline'|'color'|'none'} mark
 */
export function Kinetic({
    text,
    size,
    color,
    accent,
    accentText,
    delay = 0,
    stagger = 3,
    align = 'center',
    weight = 800,
    variant = 'rise',
    mark = 'auto',
    maxWidth,
    lineHeight = 1.02,
    secondColor,
    font,
    upper = false,
}) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const beat = useBeat();
    const raw = String(text || '');
    const lines = raw.split('\n').map((l) => l.trim().split(/\s+/).filter(Boolean));
    const flat = lines.flat();
    const key = mark === 'none' ? -1 : keyWordIndex(lines[lines.length - 1].join(' ')) + (flat.length - lines[lines.length - 1].length);
    // A brand colour marks its word in colour; a grey or near-text accent gets a solid marker instead.
    const markStyle = mark === 'auto' ? (near(accent, color) || !chromatic(accent) ? 'marker' : 'color') : mark;
    const allIn = delay + flat.length * stagger + 10;
    const markP = ease(frame, allIn, allIn + 10);
    let n = 0;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center', maxWidth }}>
            {lines.map((words, li) => (
                <div
                    key={li}
                    style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
                        columnGap: '0.24em',
                        rowGap: `${(lineHeight - 1) * 0.5 + 0.02}em`,
                        fontSize: size,
                        fontWeight: weight,
                        fontFamily: font,
                        lineHeight,
                        letterSpacing: upper ? '0.01em' : '-0.035em',
                        textTransform: upper ? 'uppercase' : undefined,
                        color: li > 0 && secondColor ? secondColor : color,
                        textAlign: align,
                    }}
                >
                    {words.map((w) => {
                        const i = n++;
                        return (
                            <Word
                                key={i}
                                word={w}
                                i={i}
                                local={frame - delay - i * stagger - li * 4}
                                variant={variant}
                                fps={fps}
                                size={size}
                                marked={i === key}
                                markP={markP}
                                markStyle={markStyle}
                                accent={accent}
                                accentText={accentText}
                                punch={frame > allIn ? beat : 0}
                            />
                        );
                    })}
                </div>
            ))}
        </div>
    );
}

/** Supporting line: rises in as one block, quieter than the headline. */
export function Subline({ text, size, color, delay = 10, align = 'center', maxWidth, marginTop }) {
    const frame = useCurrentFrame();
    const p = ease(frame, delay, delay + 14, [0, 1], expoOut);
    if (!text) return null;
    return (
        <div
            style={{
                fontSize: size,
                fontWeight: 500,
                lineHeight: 1.34,
                letterSpacing: '-0.01em',
                color,
                opacity: p * 0.78,
                transform: `translateY(${(1 - p) * size * 0.6}px)`,
                textAlign: align,
                maxWidth,
                marginTop: marginTop ?? size * 0.75,
            }}
        >
            {text}
        </div>
    );
}

/** Small label above a headline: a rule that draws in, then the text. */
export function Eyebrow({ text, size, accent, color, delay = 0, align = 'center' }) {
    const frame = useCurrentFrame();
    const line = ease(frame, delay, delay + 12, [0, 1], expoOut);
    const p = ease(frame, delay + 4, delay + 16, [0, 1], expoOut);
    if (!text) return null;
    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
                gap: size * 0.7,
                marginBottom: size * 1.1,
                color: color || accent,
                fontSize: size,
                fontWeight: 700,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
            }}
        >
            <span style={{ width: size * 2.2 * line, height: Math.max(2, size * 0.1), background: accent, borderRadius: 9 }} />
            <span style={{ opacity: p, transform: `translateX(${(1 - p) * -size}px)`, whiteSpace: 'nowrap' }}>{text}</span>
        </div>
    );
}

/** A row of glass pills that fly in one by one (product names, platforms, list items). */
export function Chips({ items = [], size, palette, delay = 12, align = 'center', dark }) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const beat = useBeat();
    if (!items.length) return null;
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: size * 0.5, justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center', marginTop: size * 1.3 }}>
            {items.map((item, i) => {
                const p = pop(frame, fps, delay + i * 5, { damping: 12, stiffness: 150, mass: 0.7 });
                const on = frame > delay + i * 5 + 14;
                return (
                    <div
                        key={i}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: size * 0.45,
                            padding: `${size * 0.5}px ${size * 0.95}px`,
                            borderRadius: 999,
                            fontSize: size,
                            fontWeight: 700,
                            color: palette.fg,
                            background: dark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.75)',
                            border: `1px solid ${dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.1)'}`,
                            boxShadow: `0 ${size * 0.4}px ${size * 1.2}px rgba(0,0,0,${dark ? 0.35 : 0.1})`,
                            opacity: Math.min(1, p * 1.4),
                            transform: `translateY(${(1 - p) * size * 2}px) rotate(${(1 - p) * (i % 2 ? 6 : -6)}deg) scale(${1 + (on ? beat * 0.04 : 0)})`,
                        }}
                    >
                        <span style={{ width: size * 0.5, height: size * 0.5, borderRadius: '50%', background: palette.accent, boxShadow: `0 0 ${size * 0.6}px ${alpha(palette.accent, 0.8)}` }} />
                        {item}
                    </div>
                );
            })}
        </div>
    );
}

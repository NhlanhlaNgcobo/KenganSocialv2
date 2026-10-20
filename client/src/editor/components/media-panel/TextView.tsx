import { useState } from 'react';
import { TEXT_ANIMATIONS, captionFrame } from '../../lib/caption-motion.js';
import { usePreviewTime } from '../../hooks/use-preview-time';
import { usePlaybackStore } from '../../stores/playback-store';
import { useTimelineStore } from '../../stores/timeline-store';
import { DRAG_MIME, type TextElement } from '../../types';

const PRESETS: { label: string; content: string; style: Partial<TextElement> }[] = [
    { label: 'Heading', content: 'Heading', style: { fontSize: 110, fontWeight: 'bold' } },
    { label: 'Subheading', content: 'Subheading', style: { fontSize: 72, fontWeight: 'bold' } },
    { label: 'Body', content: 'Body text', style: { fontSize: 52, fontWeight: 'normal' } },
    { label: 'Hook', content: 'WAIT FOR IT…', style: { fontSize: 96, fontWeight: 'bold', fontFamily: 'Impact', color: '#facc15' } },
    { label: 'Label', content: 'Label', style: { fontSize: 44, fontWeight: 'bold', backgroundColor: '#e4e4e7', color: '#0a0a0b' } },
    { label: 'Lower third', content: 'Name Surname', style: { fontSize: 56, backgroundColor: 'rgba(0,0,0,0.6)', y: 600 } },
];

function AnimatedTitle({ id, label }: { id: string; label: string }) {
    const [active, setActive] = useState(false);
    const time = usePreviewTime(active, 2.5);
    const frame = captionFrame('Your story', [], id, time, 2.5);
    return <button className="ke-text-card" onMouseEnter={() => setActive(true)} onMouseLeave={() => setActive(false)} onFocus={() => setActive(true)} onBlur={() => setActive(false)}
        onClick={() => useTimelineStore.getState().addTextAtTime(usePlaybackStore.getState().currentTime, { content: 'Your story', name: label, captionMotion: id, animation: 'none', fontSize: 86, fontWeight: 'bold' })}>
        <span style={{ transform: `translateY(${frame.y / 8}px) scale(${frame.scale})`, opacity: frame.opacity, fontSize: 16 }}>
            {frame.chunks.map((c, i) => <span key={i}><span style={{ opacity: c.opacity }}>{c.text}</span>{c.tail ? <span style={{ visibility: 'hidden' }}>{c.tail}</span> : null}{c.breakAfter ? <br /> : ' '}</span>)}
        </span><small>{label}</small>
    </button>;
}

export function TextView() {
    const addTextAtTime = useTimelineStore((s) => s.addTextAtTime);

    return (
        <div className="ke-view">
            <div className="ke-view__head">
                <h3>Text</h3>
            </div>
            <p className="ke-note">Click to add at the playhead, or drag onto the timeline.</p>
            <h4>Kengan title animations</h4>
            <div className="ke-text-grid">
                {TEXT_ANIMATIONS.map((a) => <AnimatedTitle key={a.id} id={a.id} label={a.label} />)}
            </div>
            <p className="ke-note">Animated titles can be up to 30 seconds long. Edit text, timing and motion in Properties.</p>
            <h4>Text styles</h4>
            <div className="ke-text-grid">
                {PRESETS.map((preset) => (
                    <button
                        key={preset.label}
                        className="ke-text-card"
                        draggable
                        onDragStart={(e) => {
                            e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: 'text', content: preset.content, style: { ...preset.style, name: preset.label } }));
                            e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() =>
                            addTextAtTime(usePlaybackStore.getState().currentTime, {
                                ...preset.style,
                                content: preset.content,
                                name: preset.label,
                            })
                        }
                    >
                        <span
                            style={{
                                fontFamily: preset.style.fontFamily || 'Inter',
                                fontWeight: preset.style.fontWeight === 'bold' ? 700 : 400,
                                color: preset.style.color || '#fff',
                                background: preset.style.backgroundColor || 'transparent',
                                fontSize: Math.min(22, Math.max(12, (preset.style.fontSize || 60) / 5)),
                            }}
                        >
                            {preset.content}
                        </span>
                        <small>{preset.label}</small>
                    </button>
                ))}
            </div>
        </div>
    );
}

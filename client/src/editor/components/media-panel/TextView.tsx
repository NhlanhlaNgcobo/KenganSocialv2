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

export function TextView() {
    const addTextAtTime = useTimelineStore((s) => s.addTextAtTime);

    return (
        <div className="ke-view">
            <div className="ke-view__head">
                <h3>Text</h3>
            </div>
            <p className="ke-note">Click to add at the playhead, or drag onto the timeline.</p>
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

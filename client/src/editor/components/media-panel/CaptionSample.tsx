import type { CaptionTemplate } from '../../lib/caption-templates';
import { captionLook, captionText } from '../../lib/caption-templates';
import { captionFrame } from '../../lib/caption-motion.js';
import { previewFont } from '../../constants';
import { usePreviewTime } from '../../hooks/use-preview-time';

export function CaptionSample({ template: t, active }: { template: CaptionTemplate; active: boolean }) {
    const time = usePreviewTime(active, 1.8);
    const sample = captionText(t.id, t.words < 3 ? 'Make it' : t.words > 4 ? 'Make every little moment count' : 'Make it count');
    const look = captionLook(t.id, 1, sample, 1920);
    const motion = t.style.captionMotion ? captionFrame(sample, [], t.style.captionMotion, time, 1.6, look.color, look.accentColor) : null;
    return <span className="ke-cap-card__stage">
        <span style={{
            fontFamily: previewFont(t.style.fontFamily || 'Inter'), fontWeight: t.style.fontWeight,
            fontStyle: t.style.fontStyle, color: look.color, background: t.style.backgroundColor,
            padding: '3px 5px', borderRadius: 3, fontSize: Math.max(11, Math.min(18, (t.style.fontSize || 60) / 5)),
            lineHeight: 1.3, transform: `scale(${motion?.scale || 1}) translateY(${(motion?.y || 0) / 5}px)`,
            opacity: motion?.opacity ?? 1,
        }}>
            {motion ? motion.chunks.map((c, i) => <span key={i}>
                <span style={{ color: c.color, opacity: c.opacity, textDecoration: c.underline ? 'underline' : undefined }}>{c.text}</span>
                {c.tail ? <span style={{ visibility: 'hidden' }}>{c.tail}</span> : null}
                {c.breakAfter ? <br /> : ' '}
            </span>) : sample}
        </span>
    </span>;
}

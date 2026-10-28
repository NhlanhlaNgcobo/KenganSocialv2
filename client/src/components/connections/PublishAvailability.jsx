import { useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';

const LABELS = {
    'approved-to-publish': { text: 'Can publish', tone: 'success' },
    connected: { text: 'Connected · publishing needs platform review', tone: 'warning' },
    'review-required': { text: 'Publishing needs platform review', tone: 'warning' },
    expired: { text: 'Connection expired · reconnect', tone: 'danger' },
    'manual-export-only': { text: 'Export & post manually', tone: 'muted' },
};
const NAMES = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', meta_ads: 'Meta Ads', linkedin: 'LinkedIn', x: 'X' };

/** Per network: whether we can publish there now, or you export the video and post it yourself. */
export default function PublishAvailability({ workspaceId }) {
    const [platforms, setPlatforms] = useState(null);
    useEffect(() => {
        if (!workspaceId) return undefined;
        let live = true;
        apiClient('/connections/availability')
            .then((d) => live && setPlatforms(d.platforms || []))
            .catch(() => live && setPlatforms([]));
        return () => { live = false; };
    }, [workspaceId]);
    if (!platforms?.length) return null;
    return (
        <section className="card" aria-labelledby="publish-availability-title" style={{ marginBottom: 24 }}>
            <h3 id="publish-availability-title">Publishing by network</h3>
            <p className="text-muted">Connecting an account and being allowed to post are separate: some networks need to review our app first. Where we can't post for you, export the video from the editor and post it yourself.</p>
            <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
                {platforms.map((p) => {
                    const label = LABELS[p.status] || { text: p.status, tone: 'muted' };
                    return (
                        <li key={p.platform} style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
                            <strong style={{ minWidth: 90 }}>{NAMES[p.platform] || p.platform}</strong>
                            <span className={`badge badge-${label.tone}`}>{label.text}</span>
                            {p.note ? <small className="text-muted">{p.note}</small> : null}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

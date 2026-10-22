import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';

export function AdCaptions({ captions = [] }) {
    const frame = useCurrentFrame();
    const { fps, width } = useVideoConfig();
    const caption = captions.find(c => frame / fps >= c.start && frame / fps <= c.end);
    if (!caption) return null;
    return <div style={{ position: 'absolute', bottom: '5%', left: '7%', right: '7%', textAlign: 'center', zIndex: 20 }}>
        <span style={{ display: 'inline-block', background: 'rgba(0,0,0,.85)', color: 'white', borderRadius: 14, padding: '12px 22px', fontSize: Math.round(width * 0.034), lineHeight: 1.35, fontWeight: 600 }}>{caption.text}</span>
    </div>;
}

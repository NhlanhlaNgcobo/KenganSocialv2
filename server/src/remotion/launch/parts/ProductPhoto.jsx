import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export function ProductPhoto({ scene, props, durationFrames }) {
    const frame = useCurrentFrame();
    const { width, height } = useVideoConfig();
    const vertical = height >= width;
    const scale = interpolate(frame, [0, durationFrames], [1, 1.06], { extrapolateRight: 'clamp' });
    return <AbsoluteFill style={{ padding: vertical ? '10% 8% 14%' : '8%', display: 'flex', flexDirection: vertical ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: 48 }}>
        <div style={{ flex: 1, minHeight: 0, minWidth: 0, alignSelf: 'stretch', overflow: 'hidden', borderRadius: 30, background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 24px 80px #0003' }}>
            <Img src={scene.screenshotData} style={{ width: '100%', height: '100%', objectFit: 'contain', transform: `scale(${scale})` }} />
        </div>
        <div style={{ flex: vertical ? '0 0 auto' : '0 0 38%', textAlign: vertical ? 'center' : 'left', color: props.palette.fg }}>
            <div style={{ fontSize: width * .019, letterSpacing: 3, textTransform: 'uppercase', color: props.palette.accent, marginBottom: 18 }}>{props.productName}</div>
            <div style={{ fontSize: width * (vertical ? .065 : .045), fontWeight: 800, lineHeight: 1.08, letterSpacing: -2 }}>{scene.headline}</div>
        </div>
    </AbsoluteFill>;
}

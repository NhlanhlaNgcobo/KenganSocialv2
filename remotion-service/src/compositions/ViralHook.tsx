import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, Video, interpolate } from 'remotion';
import React from 'react';

export const ViralHook: React.FC<{
    hookText: string;
    backgroundVideoSrc: string;
    accentColor: string;
}> = ({ hookText, backgroundVideoSrc, accentColor = '#ef4444' }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();

    // Slide up animation starting frame 10
    const slideY = spring({
        fps,
        frame: frame - 10,
        from: 200,
        to: 0,
        config: { damping: 14 }
    });

    const opacity = interpolate(frame, [10, 20], [0, 1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });

    return (
        <AbsoluteFill style={{ backgroundColor: 'black' }}>
            {backgroundVideoSrc && (
                <AbsoluteFill style={{ filter: 'blur(10px) brightness(0.6)', transform: 'scale(1.1)' }}>
                    <Video src={backgroundVideoSrc} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </AbsoluteFill>
            )}

            <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: '60px' }}>
                <div style={{
                    transform: `translateY(${slideY}px)`,
                    opacity,
                    background: 'rgba(0,0,0,0.85)',
                    padding: '40px 60px',
                    borderRadius: '24px',
                    borderLeft: `12px solid ${accentColor}`,
                    boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
                }}>
                    <h1 style={{
                        fontFamily: 'sans-serif',
                        fontSize: '90px',
                        fontWeight: 900,
                        color: 'white',
                        margin: 0,
                        lineHeight: 1.1,
                        textShadow: '0 4px 12px rgba(0,0,0,0.5)'
                    }}>
                        {hookText}
                    </h1>
                </div>
            </AbsoluteFill>
        </AbsoluteFill>
    );
};

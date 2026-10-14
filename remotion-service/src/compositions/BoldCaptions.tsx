import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, Video } from 'remotion';
import React from 'react';

export const BoldCaptions: React.FC<{
    words: { text: string; start: number; end: number }[];
    primaryColor: string;
    fontFamily: string;
    videoSrc: string;
}> = ({ words, primaryColor = '#8b5cf6', fontFamily = 'sans-serif', videoSrc }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const currentTime = frame / fps;

    return (
        <AbsoluteFill style={{ backgroundColor: 'black' }}>
            {videoSrc && <Video src={videoSrc} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}

            <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: '40px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'center' }}>
                    {words.map((w, i) => {
                        const isActive = currentTime >= w.start && currentTime <= w.end;
                        const hasPassed = currentTime > w.end;

                        const scale = spring({
                            fps,
                            frame: isActive ? frame - (w.start * fps) : 0,
                            config: { damping: 12 },
                            from: 0.8,
                            to: 1.0,
                        });

                        return (
                            <span
                                key={i}
                                style={{
                                    fontFamily,
                                    fontSize: '80px',
                                    fontWeight: 900,
                                    textTransform: 'uppercase',
                                    color: isActive ? primaryColor : (hasPassed ? 'white' : 'rgba(255,255,255,0.4)'),
                                    transform: isActive ? `scale(${scale})` : 'scale(1)',
                                    textShadow: '0 4px 12px rgba(0,0,0,0.8)',
                                    transition: 'color 0.1s',
                                    lineHeight: '1.2'
                                }}
                            >
                                {w.text}
                            </span>
                        );
                    })}
                </div>
            </AbsoluteFill>
        </AbsoluteFill>
    );
};

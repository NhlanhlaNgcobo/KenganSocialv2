import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, Img } from 'remotion';
import React from 'react';

export const PodcastClip: React.FC<{
    audioWaveform: number[];
    quote: string;
    speakerName: string;
    speakerAvatar: string;
    accentColor: string;
}> = ({ audioWaveform = Array(40).fill(0.5), quote, speakerName, speakerAvatar, accentColor = '#8b5cf6' }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();

    // Typewriter effect
    const words = quote.split(' ');
    const wordsToShow = Math.floor(frame / 5); // 1 word every 5 frames
    const currentQuote = words.slice(0, wordsToShow).join(' ');

    const containerOpacity = spring({ fps, frame: frame - 5, from: 0, to: 1 });

    return (
        <AbsoluteFill style={{ backgroundColor: '#111', padding: '80px', display: 'flex', flexDirection: 'column' }}>

            <div style={{ flex: 1, display: 'flex', alignItems: 'center', opacity: containerOpacity }}>
                <h1 style={{
                    fontFamily: 'Georgia, serif',
                    fontSize: '90px',
                    color: 'white',
                    lineHeight: 1.3,
                    fontWeight: 400
                }}>
                    "{currentQuote}"
                </h1>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '40px', marginTop: '60px' }}>
                {speakerAvatar && (
                    <Img
                        src={speakerAvatar}
                        style={{
                            width: '180px', height: '180px', borderRadius: '50%', objectFit: 'cover',
                            border: `6px solid ${accentColor}`
                        }}
                    />
                )}
                <div style={{ flex: 1 }}>
                    <h2 style={{ fontFamily: 'sans-serif', fontSize: '50px', color: 'white', margin: 0, fontWeight: 700 }}>
                        {speakerName}
                    </h2>

                    {/* Animated Waveform Simulation */}
                    <div style={{ display: 'flex', gap: '8px', marginTop: '20px', alignItems: 'center', height: '80px' }}>
                        {audioWaveform.slice(0, 30).map((v, i) => {
                            // Pseudo-random oscillation linked to frame and index
                            const waveScale = 0.3 + (Math.sin(frame * 0.2 + i) * 0.5 + 0.5) * 0.7;
                            return (
                                <div key={i} style={{
                                    width: '12px',
                                    height: `${waveScale * 100}%`,
                                    background: accentColor,
                                    borderRadius: '6px'
                                }} />
                            );
                        })}
                    </div>
                </div>
            </div>

        </AbsoluteFill>
    );
};

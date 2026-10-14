import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, Img } from 'remotion';
import React from 'react';

export const CinematicIntro: React.FC<{
    logo: string;
    tagline: string;
    primaryColor: string;
}> = ({ logo, tagline, primaryColor = '#ffffff' }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();

    // Animations
    const logoOpacity = spring({ fps, frame: frame - 15, from: 0, to: 1, config: { damping: 200 } });
    const logoScale = spring({ fps, frame: frame - 15, from: 0.8, to: 1, config: { mass: 0.5 } });

    // Typewriter effect (starts at frame 45)
    const typingFrame = Math.max(0, frame - 45);
    const charsToShow = Math.floor(typingFrame / 2);
    const currentTagline = tagline.substring(0, charsToShow);

    return (
        <AbsoluteFill style={{ backgroundColor: 'black', justifyContent: 'center', alignItems: 'center' }}>

            {/* Letterbox Bars */}
            <div style={{ position: 'absolute', top: 0, width: '100%', height: '12%', background: '#000', zIndex: 10 }} />
            <div style={{ position: 'absolute', bottom: 0, width: '100%', height: '12%', background: '#000', zIndex: 10 }} />

            <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '30px',
                opacity: logoOpacity, transform: `scale(${logoScale})`
            }}>
                {logo && <Img src={logo} style={{ width: '250px', objectFit: 'contain' }} />}

                <h2 style={{
                    color: primaryColor,
                    fontFamily: 'sans-serif',
                    fontSize: '48px',
                    fontWeight: 700,
                    letterSpacing: '8px',
                    textTransform: 'uppercase',
                    margin: 0
                }}>
                    {currentTagline}
                </h2>
            </div>

        </AbsoluteFill>
    );
};

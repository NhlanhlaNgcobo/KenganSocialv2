import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { LaunchVideo } from './LaunchVideo.jsx';

const SIZES = {
    landscape: { width: 1920, height: 1080 },
    vertical: { width: 1080, height: 1920 },
    square: { width: 1080, height: 1080 },
};

const FPS = 30;

const Root = () => (
    <Composition
        id="LaunchVideo"
        component={LaunchVideo}
        fps={FPS}
        width={1920}
        height={1080}
        durationInFrames={600}
        defaultProps={{
            format: 'landscape',
            tone: 'default',
            palette: { bg: '#0d0d10', fg: '#ffffff', accent: '#e04a18', accentText: '#ffffff' },
            fontFamily: 'Inter',
            productName: 'Product',
            host: 'example.com',
            iconData: null,
            music: null,
            kind: 'launch',
            beats: [],
            sfx: {},
            shotAspect: 16 / 9,
            totalSteps: 0,
            square: false,
            scenes: [{ type: 'hook', duration: 3, headline: 'Launch video', subline: '', screenshot: null }],
        }}
        calculateMetadata={({ props }) => ({
            ...(SIZES[props.format] || SIZES.landscape),
            durationInFrames: Math.max(1, props.scenes.reduce((sum, s) => sum + Math.round(s.duration * FPS), 0)),
        })}
    />
);

registerRoot(Root);

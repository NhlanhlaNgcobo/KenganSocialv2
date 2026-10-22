import { createContext, useContext } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { beatPulse } from './motion.js';

/**
 * Where the current scene sits in the whole video, so parts inside a scene can follow the
 * music's beat grid (beats are in seconds from the start of the video).
 */
export const SceneClock = createContext({ start: 0, beats: [] });

/** 0..1, jumps on every beat of the soundtrack and decays. */
export function useBeat() {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const { start, beats } = useContext(SceneClock);
    return beatPulse((start + frame) / fps, beats);
}

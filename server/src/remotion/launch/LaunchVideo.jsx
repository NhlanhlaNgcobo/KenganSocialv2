import React, { useEffect, useState } from 'react';
import { AbsoluteFill, Audio, Sequence, continueRender, delayRender, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { Backdrop } from './parts/Backdrop.jsx';
import { beatPulse, clamp, sceneMotion, TRANSITIONS } from './parts/motion.js';
import { CardScene, HookScene, OutroScene, RevealScene, ScreenScene, TutorialIntro, TutorialStep } from './parts/Scenes.jsx';
import { screenTimings } from './parts/Screen.jsx';

/**
 * Launch and tutorial videos. Scene structure follows /brag-slim
 * (github.com/latent-spaces/brag, MIT); the look is our own: a living brand-colour backdrop,
 * kinetic type, live screens that click/type/scroll, cuts on the beat and sound effects.
 * Every frame is a pure function of the frame number.
 */

function useGoogleFont(family) {
    const [handle] = useState(() => delayRender(`font ${family}`, { timeoutInMilliseconds: 15000 }));
    useEffect(() => {
        const name = String(family || '').split(',')[0].replace(/["']/g, '').trim();
        const generic = ['ui-sans-serif', 'system-ui', 'sans-serif', 'serif', '-apple-system', 'monospace', ''];
        if (generic.includes(name)) {
            continueRender(handle);
            return;
        }
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@400;500;600;700;800;900&display=block`;
        const done = () => document.fonts.ready.then(() => continueRender(handle));
        link.onload = done;
        link.onerror = () => continueRender(handle); // not a Google font: system fallback
        document.head.appendChild(link);
    }, [family, handle]);
}

function SceneBody({ scene, index, props, durationFrames }) {
    const shared = { scene, index, props, durationFrames };
    if (props.kind === 'tutorial') {
        if (scene.type === 'intro') return <TutorialIntro {...shared} />;
        if (scene.type === 'step') return <TutorialStep {...shared} />;
        return <OutroScene {...shared} />;
    }
    if (scene.type === 'hook') return scene.screenshotData && scene.target ? <ScreenScene {...shared} /> : <HookScene {...shared} />;
    if (scene.type === 'outro') return <OutroScene {...shared} />;
    if (scene.type === 'reveal') return scene.screenshotData ? <ScreenScene {...shared} /> : <RevealScene {...shared} />;
    return scene.screenshotData ? <ScreenScene {...shared} /> : <CardScene {...shared} />;
}

function Scene({ scene, index, props, start }) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const durationFrames = Math.round(scene.duration * fps);
    const transition = TRANSITIONS[props.tone] || 'whip';
    // A small push on every beat so the picture breathes with the music.
    const bump = props.kind === 'tutorial' ? 0 : beatPulse((start + frame) / fps, props.beats) * (props.tone === 'chaotic' ? 0.03 : 0.012);
    return (
        <AbsoluteFill style={{ ...sceneMotion(frame, durationFrames, transition, fps) }}>
            <AbsoluteFill style={{ transform: `scale(${1 + bump})` }}>
                <SceneBody scene={scene} index={index} props={props} durationFrames={durationFrames} />
            </AbsoluteFill>
        </AbsoluteFill>
    );
}

function Flash({ at }) {
    const frame = useCurrentFrame();
    const o = interpolate(frame - at, [0, 1, 5], [0, 0.85, 0], clamp);
    return o > 0 ? <AbsoluteFill style={{ background: '#fff', opacity: o }} /> : null;
}

/** Where each sound effect goes, in frames from the start of the video. */
function soundCues(props, starts, fps) {
    const cues = [];
    const add = (name, frame, volume = 1) => props.sfx?.[name] && frame >= 0 && cues.push({ name, frame: Math.round(frame), volume });
    props.scenes.forEach((scene, i) => {
        const start = starts[i];
        const len = Math.round(scene.duration * fps);
        if (i > 0) add('whoosh', start - 4, props.kind === 'tutorial' ? 0.35 : 0.55);
        if (scene.type === 'reveal' || scene.type === 'outro' || scene.type === 'intro') add('impact', start + 2, 0.7);
        if (props.kind !== 'tutorial' && i === 0 && props.scenes.length > 1) add('riser', start + len - fps * 1.2, 0.35);
        if (scene.type === 'step') add('pop', start + 6, 0.45);
        const action = scene.type === 'step' ? scene.action : scene.screenshotData && scene.target ? (scene.target.kind === 'button' || scene.target.kind === 'link' ? 'click' : 'look') : null;
        if (action) {
            const t = screenTimings(len, action);
            if (t.click != null) add('click', start + t.click, 0.9);
            if (action === 'type' && scene.typed) {
                const keys = Math.min(14, scene.typed.length);
                for (let k = 0; k < keys; k++) add('key', start + t.typeFrom + ((t.typeTo - t.typeFrom) * k) / keys, 0.5);
            }
        }
        if (scene.type === 'outro') add('click', start + Math.round(len * 0.55), 0.8);
    });
    return cues;
}

export const LaunchVideo = (props) => {
    const { fps } = useVideoConfig();
    const frame = useCurrentFrame();
    useGoogleFont(props.fontFamily);
    const starts = [];
    let total = 0;
    for (const s of props.scenes) {
        starts.push(total);
        total += Math.round(s.duration * fps);
    }
    const tutorial = props.kind === 'tutorial';
    const musicLevel = tutorial ? 0.32 : 0.85;

    return (
        <AbsoluteFill style={{ fontFamily: `${props.fontFamily}, Inter, system-ui, sans-serif` }}>
            <Backdrop palette={props.palette} intensity={tutorial ? 0.7 : 1} />
            {props.music ? <Audio src={props.music} volume={(f) => interpolate(f, [0, 6, total - 6, total], [0, musicLevel, musicLevel, 0], clamp)} /> : null}
            {soundCues(props, starts, fps).map((c, i) => (
                <Sequence key={`sfx-${i}`} from={c.frame} durationInFrames={Math.round(fps * 1.5)}>
                    <Audio src={props.sfx[c.name]} volume={c.volume} />
                </Sequence>
            ))}
            {props.scenes.map((scene, i) => (
                <Sequence key={i} from={starts[i]} durationInFrames={Math.round(scene.duration * fps)}>
                    <Scene scene={scene} index={i} props={props} start={starts[i]} />
                </Sequence>
            ))}
            {props.tone === 'chaotic' ? starts.slice(1).map((at, i) => <Flash key={i} at={at} />) : null}
            {/* Progress line keeps motion alive between beats. */}
            <div
                style={{
                    position: 'absolute',
                    left: 0,
                    bottom: 0,
                    height: 5,
                    width: `${(frame / total) * 100}%`,
                    background: props.palette.accent,
                    boxShadow: `0 0 12px ${props.palette.accent}`,
                    opacity: 0.85,
                }}
            />
        </AbsoluteFill>
    );
};

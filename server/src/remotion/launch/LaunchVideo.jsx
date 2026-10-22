import React, { useEffect, useState } from 'react';
import { AbsoluteFill, Audio, Sequence, continueRender, delayRender, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import displayFontUrl from '../../../assets/fonts/Anton-Regular.ttf';
import { Backdrop } from './parts/Backdrop.jsx';
import { DISPLAY_FONT } from './parts/Decor.jsx';
import { beatPulse, clamp, ease, hashOf, OVERLAP, transitionFor, transitionStyle } from './parts/motion.js';
import { CardScene, HookScene, OutroScene, ProofScene, RevealScene, ScreenScene } from './parts/Scenes.jsx';
import { screenTimings } from './parts/Screen.jsx';
import { SceneClock } from './parts/time.js';
import { TutorialIntro, TutorialOutro, TutorialStep } from './parts/Tutorial.jsx';
import { AdCaptions } from './parts/AdCaptions.jsx';
import { ProductPhoto } from './parts/ProductPhoto.jsx';

/**
 * Launch and tutorial videos. Scene structure follows /brag-slim
 * (github.com/latent-spaces/brag, MIT); the look is our own: a living brand-colour backdrop,
 * kinetic type, 3D device mockups whose camera finds the real elements, varied transitions
 * cut on the beat, and sound effects. Every frame is a pure function of the frame number.
 */

/** Web-font family name as Google Fonts knows it ("__Inter_d65c78" or "Inter Variable" → "Inter"). */
export function cleanFamily(family) {
    return String(family || '')
        .split(',')[0]
        .replace(/["']/g, '')
        .replace(/^__/, '')
        .replace(/_(Fallback_)?[0-9a-f]{5,}$/i, '')
        .replace(/_/g, ' ')
        .replace(/\s+(Variable|VF|Display|Text)$/i, '')
        .trim();
}

/** Browser defaults and system faces: the site never chose a font, so the video uses Inter. */
const DEFAULT_FACES = /^(ui-sans-serif|system-ui|sans-serif|serif|-apple-system|monospace|BlinkMacSystemFont|Times New Roman|Times|Arial|Helvetica|Helvetica Neue|Segoe UI|Roboto|Verdana|Georgia|Tahoma)?$/i;

/** The headline family for a site font. */
export const familyFor = (family) => {
    const name = cleanFamily(family);
    return DEFAULT_FACES.test(name) ? 'Inter' : name;
};

/** Loads a Google font stylesheet and the faces it declares; resolves (never rejects) within `ms`. */
function loadGoogleFont(name, ms) {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@400;500;600;700;800;900&display=block`;
        link.onload = () =>
            Promise.all([500, 700, 800, 900].map((w) => document.fonts.load(`${w} 40px "${name}"`).catch(() => null))).then(() => {
                clearTimeout(timer);
                resolve();
            });
        link.onerror = () => resolve(); // not a Google font: Inter / system fallback
        document.head.appendChild(link);
    });
}

function useFonts(family) {
    const [handle] = useState(() => delayRender(`fonts ${family}`, { timeoutInMilliseconds: 25000 }));
    useEffect(() => {
        const name = familyFor(family);
        const display = Promise.race([
            new FontFace(DISPLAY_FONT, `url(${displayFontUrl})`)
                .load()
                .then((f) => document.fonts.add(f))
                .catch(() => {}),
            new Promise((r) => setTimeout(r, 8000)),
        ]);
        const fonts = [display, loadGoogleFont('Inter', 9000)];
        if (name !== 'Inter') fonts.push(loadGoogleFont(name, 9000));
        Promise.all(fonts).then(() => continueRender(handle));
    }, [family, handle]);
}

/** Which layout each scene uses, so consecutive scenes never look alike. */
function layoutPlan(scenes, seed) {
    const screens = ['splitRight', 'full', 'splitLeft'];
    const cards = ['statement', 'cards', 'statementRight', 'cards'];
    let s = seed % screens.length;
    let c = 0;
    let n = 0;
    const total = scenes.filter((x) => x.type === 'feature' || x.type === 'showcase').length;
    return scenes.map((scene) => {
        if (scene.type !== 'feature' && scene.type !== 'showcase') return {};
        n += 1;
        if (scene.screenshotData) return { variant: scene.type === 'showcase' && n === 1 ? 'full' : screens[s++ % screens.length], n, total };
        const variant = cards[c++ % cards.length];
        return { variant: variant === 'cards' && (scene.points || []).length < 2 ? (n % 2 ? 'statement' : 'statementRight') : variant, n, total };
    });
}

function SceneBody({ scene, index, props, durationFrames, layout }) {
    const shared = { scene, index, props, durationFrames, ...layout };
    if (props.productPhotos && scene.screenshotData && scene.type !== 'outro') return <ProductPhoto {...shared} />;
    if (props.kind === 'tutorial') {
        if (scene.type === 'intro') return <TutorialIntro {...shared} />;
        if (scene.type === 'step') return <TutorialStep {...shared} />;
        return <TutorialOutro {...shared} />;
    }
    if (scene.type === 'hook') return <HookScene {...shared} />;
    if (scene.type === 'outro') return <OutroScene {...shared} />;
    if (scene.type === 'reveal') return <RevealScene {...shared} />;
    if (scene.type === 'proof') return scene.stat?.value ? <ProofScene {...shared} /> : <CardScene {...shared} variant="statement" />;
    return scene.screenshotData ? <ScreenScene {...shared} /> : <CardScene {...shared} />;
}

function Scene({ scene, index, props, start, length, transIn, transOut, layout }) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const lead = index > 0 && transIn !== 'cut' ? OVERLAP : 0;
    const enter = lead ? ease(frame, 0, lead) : 1;
    // The exit plays over the next scene's lead-in.
    const exitLen = transOut && transOut !== 'cut' ? OVERLAP : 0;
    const exit = exitLen ? ease(frame, length - exitLen, length) : 0;
    const style = exit > 0 ? transitionStyle(transOut, 'out', exit) : enter < 1 ? transitionStyle(transIn, 'in', enter) : {};
    // A small push on every beat so the picture breathes with the music.
    const bump = props.kind === 'tutorial' ? 0 : beatPulse((start + frame) / fps, props.beats) * (props.tone === 'chaotic' ? 0.03 : 0.01);
    return (
        <SceneClock.Provider value={{ start, beats: props.beats || [] }}>
            <AbsoluteFill style={style}>
                <AbsoluteFill style={{ transform: `scale(${1 + bump})` }}>
                    <SceneBody scene={scene} index={index} props={props} durationFrames={length} layout={layout} />
                </AbsoluteFill>
            </AbsoluteFill>
        </SceneClock.Provider>
    );
}

function Flash({ at }) {
    const frame = useCurrentFrame();
    const o = interpolate(frame - at, [0, 1, 5], [0, 0.85, 0], clamp);
    return o > 0 ? <AbsoluteFill style={{ background: '#fff', opacity: o }} /> : null;
}

/** Where each sound effect goes, in frames from the start of the video. */
function soundCues(props, timeline, fps) {
    const cues = [];
    const add = (name, frame, volume = 1) => props.sfx?.[name] && frame >= 0 && cues.push({ name, frame: Math.round(frame), volume });
    props.scenes.forEach((scene, i) => {
        const { from, length, cut } = timeline[i];
        if (i > 0) add('whoosh', cut - OVERLAP + 1, props.kind === 'tutorial' ? 0.35 : 0.55);
        if (scene.type === 'reveal' || scene.type === 'outro' || scene.type === 'intro' || scene.type === 'proof') add('impact', cut + 1, 0.7);
        if (props.kind !== 'tutorial' && i === 0 && props.scenes.length > 1) add('riser', from + length - fps * 1.2, 0.35);
        if (scene.type === 'step') add('pop', cut + 4, 0.45);
        const launchAction = scene.screenshotData && scene.target && scene.type !== 'hook' && scene.type !== 'reveal' ? (scene.target.kind === 'button' || scene.target.kind === 'link' ? 'click' : 'look') : null;
        const action = scene.type === 'step' ? scene.action : launchAction;
        if (action) {
            const next = props.scenes[i + 1];
            const page = scene.type === 'step' && action === 'click' && next?.type === 'step' && next.path !== scene.path;
            const t = screenTimings(length, action, { settle: scene.type === 'step', page });
            if (t.click != null) add('click', from + t.click, 0.9);
            if (action === 'type' && scene.typed) {
                const keys = Math.min(14, scene.typed.length);
                for (let k = 0; k < keys; k++) add('key', from + t.typeFrom + ((t.typeTo - t.typeFrom) * k) / keys, 0.5);
            }
        }
        if (scene.type === 'outro' && scene.cta) add('click', from + Math.round(length * (props.kind === 'tutorial' ? 0.7 : 0.6)), 0.8);
    });
    return cues;
}

export const LaunchVideo = (props) => {
    const { fps } = useVideoConfig();
    useFonts(props.fontFamily);
    const tutorial = props.kind === 'tutorial';
    const tone = tutorial ? 'tutorial' : props.tone;
    const seed = hashOf(props.productName) % 7;

    // Each scene's cut point stays where the plan put it (on the beat); from scene 2 on, a scene
    // starts OVERLAP frames early so its entrance plays over the previous scene's exit.
    const timeline = [];
    let cut = 0;
    props.scenes.forEach((s, i) => {
        const len = Math.round(s.duration * fps);
        const transIn = i > 0 ? transitionFor(tone, i, seed) : null;
        const lead = i > 0 && transIn !== 'cut' ? OVERLAP : 0;
        timeline.push({ cut, from: cut - lead, length: len + lead, transIn });
        cut += len;
    });
    const total = cut;
    const layouts = layoutPlan(props.scenes, seed);
    const musicLevel = props.narration ? 0.3 : tutorial ? 0.32 : 0.85;

    return (
        <AbsoluteFill style={{ fontFamily: `"${familyFor(props.fontFamily)}", Inter, system-ui, sans-serif`, overflow: 'hidden' }}>
            <Backdrop palette={props.palette} intensity={tutorial ? 0.7 : 1} cuts={timeline.map((t) => t.cut)} grid />
            {props.music ? <Audio src={props.music} volume={(f) => interpolate(f, [0, 6, total - 6, total], [0, musicLevel, musicLevel, 0], clamp)} /> : null}
            {props.narration ? <Audio src={props.narration} volume={1} /> : null}
            {soundCues(props, timeline, fps).map((c, i) => (
                <Sequence key={`sfx-${i}`} from={c.frame} durationInFrames={Math.round(fps * 1.5)}>
                    <Audio src={props.sfx[c.name]} volume={c.volume} />
                </Sequence>
            ))}
            {props.scenes.map((scene, i) => (
                <Sequence key={i} from={timeline[i].from} durationInFrames={timeline[i].length}>
                    <Scene
                        scene={scene}
                        index={i}
                        props={props}
                        start={timeline[i].from}
                        length={timeline[i].length}
                        transIn={timeline[i].transIn}
                        transOut={timeline[i + 1]?.transIn}
                        layout={layouts[i]}
                    />
                </Sequence>
            ))}
            {props.tone === 'chaotic' && !tutorial ? timeline.slice(1).map((t, i) => <Flash key={i} at={t.cut} />) : null}
            {props.narration ? <AdCaptions captions={props.captions} /> : null}
        </AbsoluteFill>
    );
};

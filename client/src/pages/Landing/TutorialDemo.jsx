import { useEffect, useRef, useState } from 'react';
import './TutorialDemo.css';
import { CalendarCheck, Check, Film, Instagram, Music2, Sparkles, Upload, Wand2, Youtube } from 'lucide-react';
import LoopVideo from './LoopVideo';

/**
 * A self-playing walkthrough of the app: each step is a scene whose CSS animations restart when it
 * mounts. The footage is real: sample videos (Pexels) and the clips KenganSocial's own renderer
 * made from them (public/landing, built by scripts/build-landing-media.mjs). Steps advance on a
 * timer while the demo is on screen and can be picked from the tabs underneath.
 */

const MEDIA = '/landing';

const STEPS = [
    { id: 'drop', title: 'Drop in a long video', text: 'Upload a podcast, stream or talk you recorded.' },
    { id: 'target', title: 'Pick where it goes', text: 'TikTok, Shorts or Reels set the shape, length and caption spot.' },
    { id: 'moments', title: 'AI finds the moments', text: 'It transcribes, scores every moment and cuts the best ones.' },
    { id: 'frame', title: 'Faces framed, captions on', text: 'Two speakers get stacked so nobody is cut off.' },
    { id: 'schedule', title: 'Schedule everywhere', text: 'Every short lands on your calendar, ready to post.' },
];
const STEP_MS = 5200;

function Cursor({ path }) {
    return (
        <svg className={`td-cursor td-cursor--${path}`} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 2l15 9-6.5 1.6L16 20l-3 1.4-3.4-7.4L4 18z" />
        </svg>
    );
}

function SceneDrop() {
    return (
        <div className="td-scene td-drop">
            <div className="td-label">Repurpose → Video → shorts</div>
            <div className="td-file">
                <span className="td-file__thumb">
                    <img src={`${MEDIA}/studio-still.jpg`} alt="" />
                    <i>48:12</i>
                </span>
                <div>
                    <strong>podcast-episode-12.mp4</strong>
                    <small>48:12 · 1.2 GB · uploading</small>
                </div>
                <div className="td-file__bar">
                    <i />
                </div>
            </div>
            <div className="td-strip" aria-hidden="true">
                {['moment-1', 'moment-2', 'studio-still', 'moment-3'].map((m, i) => (
                    <img key={m} src={`${MEDIA}/${m}.jpg`} alt="" style={{ '--i': i }} />
                ))}
                <span className="td-strip__scan" />
            </div>
            <Cursor path="drop" />
        </div>
    );
}

function SceneTarget() {
    const cards = [
        { icon: Music2, label: 'TikTok', shot: 'clip-split' },
        { icon: Youtube, label: 'YouTube Shorts', shot: 'clip-karaoke' },
        { icon: Instagram, label: 'Instagram Reels', shot: 'clip-track' },
    ];
    return (
        <div className="td-scene td-target">
            <div className="td-label">Where are these shorts going?</div>
            <div className="td-cards">
                {cards.map((c, i) => (
                    <div key={c.label} className={`td-card ${i === 0 ? 'td-card--pick' : ''}`}>
                        <img className="td-card__shot" src={`${MEDIA}/${c.shot}.jpg`} alt="" />
                        <span className="td-card__text">
                            <c.icon className="td-ico" />
                            <strong>{c.label}</strong>
                            <small>9:16</small>
                        </span>
                    </div>
                ))}
            </div>
            <div className="td-label td-label--sub">Caption template</div>
            <div className="td-templates">
                <span className="td-tpl td-tpl--pick">
                    THIS <b>CHANGED</b>
                </span>
                <span className="td-tpl td-tpl--impact">
                    BIG <b>WIN</b>
                </span>
                <span className="td-tpl td-tpl--box">Clean</span>
                <span className="td-tpl td-tpl--neon">NEON</span>
            </div>
            <Cursor path="target" />
        </div>
    );
}

function SceneMoments() {
    const clips = [
        { score: 94, title: 'We almost quit before episode one', thumb: 'moment-1' },
        { score: 88, title: '"Nobody saw this coming"', thumb: 'moment-2' },
        { score: 81, title: 'The habit that doubled our audience', thumb: 'moment-3' },
    ];
    return (
        <div className="td-scene td-moments">
            <div className="td-label">
                <Sparkles className="td-ico td-ico--inline" /> Finding the best moments
            </div>
            <div className="td-scan" aria-hidden="true">
                <LoopVideo name="studio-wide" className="td-scan__video" eager />
                <span className="td-scan__line" />
            </div>
            <div className="td-wave" aria-hidden="true">
                {Array.from({ length: 48 }, (_, i) => (
                    <i key={i} style={{ '--h': `${20 + ((i * 37) % 70)}%`, '--d': `${(i % 12) * 60}ms` }} />
                ))}
                <span className="td-wave__scan" />
            </div>
            <div className="td-progress">
                <i />
            </div>
            <div className="td-clips">
                {clips.map((c, i) => (
                    <div key={c.title} className="td-clip" style={{ '--i': i }}>
                        <img className="td-clip__thumb" src={`${MEDIA}/${c.thumb}.jpg`} alt="" />
                        <span className="td-clip__title">{c.title}</span>
                        <span className={`td-score ${c.score > 90 ? 'is-high' : ''}`}>{c.score}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function SceneFrame() {
    return (
        <div className="td-scene td-frame">
            <div className="td-source">
                <div className="td-source__frame">
                    <LoopVideo name="studio-wide" className="td-media" eager />
                    <span className="td-face td-face--a" />
                    <span className="td-face td-face--b" />
                </div>
                <small>16:9 source · 2 faces found</small>
            </div>
            <div className="td-arrow" aria-hidden="true">
                <Wand2 className="td-ico" />
            </div>
            <div className="td-phone">
                <LoopVideo name="clip-split" className="td-media" eager />
                <span className="td-phone__badge">Real output</span>
            </div>
        </div>
    );
}

function SceneSchedule() {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const posts = [
        { day: 0, row: 0, kind: 'tt', label: 'TikTok 18:00', shot: 'clip-split' },
        { day: 1, row: 1, kind: 'yt', label: 'Shorts 12:30', shot: 'clip-karaoke' },
        { day: 2, row: 0, kind: 'ig', label: 'Reels 19:00', shot: 'clip-track' },
        { day: 3, row: 1, kind: 'tt', label: 'TikTok 17:30', shot: 'clip-neon' },
        { day: 4, row: 0, kind: 'ig', label: 'Reels 18:15', shot: 'clip-split' },
    ];
    return (
        <div className="td-scene td-schedule">
            <div className="td-label">
                <CalendarCheck className="td-ico td-ico--inline" /> This week
            </div>
            <div className="td-week">
                {days.map((d, di) => (
                    <div key={d} className="td-day">
                        <small>{d}</small>
                        {posts
                            .filter((p) => p.day === di)
                            .map((p) => (
                                <span key={p.label} className={`td-post td-post--${p.kind}`} style={{ '--i': p.day, marginTop: p.row ? '2.2cqw' : 0 }}>
                                    <img src={`${MEDIA}/${p.shot}.jpg`} alt="" />
                                    {p.label}
                                </span>
                            ))}
                    </div>
                ))}
            </div>
            <div className="td-toast">
                <Check className="td-ico" /> 5 shorts scheduled
            </div>
            <Cursor path="schedule" />
        </div>
    );
}

const SCENES = { drop: SceneDrop, target: SceneTarget, moments: SceneMoments, frame: SceneFrame, schedule: SceneSchedule };

export default function TutorialDemo() {
    const [step, setStep] = useState(0);
    // Without IntersectionObserver (old browsers) the demo just plays.
    const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
    const [cycle, setCycle] = useState(0);
    const ref = useRef(null);

    // Only play while the demo is on screen.
    useEffect(() => {
        const el = ref.current;
        if (!el || typeof IntersectionObserver === 'undefined') return undefined;
        const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.25 });
        io.observe(el);
        return () => io.disconnect();
    }, []);

    useEffect(() => {
        if (!visible) return undefined;
        const timer = setTimeout(() => {
            setStep((s) => (s + 1) % STEPS.length);
            setCycle((c) => c + 1);
        }, STEP_MS);
        return () => clearTimeout(timer);
    }, [visible, step, cycle]);

    const pick = (i) => {
        setStep(i);
        setCycle((c) => c + 1);
    };

    const Scene = SCENES[STEPS[step].id];

    return (
        <div className={`td ${visible ? 'is-playing' : ''}`} ref={ref}>
            <div className="td-window">
                <div className="td-chrome">
                    <span className="td-dots">
                        <i />
                        <i />
                        <i />
                    </span>
                    <span className="td-url">kengansocial.co.za/dashboard/{STEPS[step].id === 'schedule' ? 'calendar' : 'repurpose'}</span>
                    <span className="td-step-count">
                        {step + 1}/{STEPS.length}
                    </span>
                </div>
                <div className="td-body">
                    <aside className="td-side" aria-hidden="true">
                        {[Upload, Film, Wand2, CalendarCheck, Sparkles].map((Icon, i) => (
                            <span key={i} className={i === Math.min(step, 4) ? 'is-active' : ''}>
                                <Icon className="td-ico" />
                            </span>
                        ))}
                    </aside>
                    <div className="td-stage" key={`${step}-${cycle}`}>
                        <Scene />
                    </div>
                </div>
            </div>

            <ol className="td-tabs">
                {STEPS.map((s, i) => (
                    <li key={s.id}>
                        <button type="button" className={i === step ? 'is-active' : i < step ? 'is-done' : ''} onClick={() => pick(i)} aria-current={i === step ? 'step' : undefined}>
                            <span className="td-tabs__num">{i + 1}</span>
                            <span className="td-tabs__text">
                                <strong>{s.title}</strong>
                                <small>{s.text}</small>
                            </span>
                            <span className="td-tabs__bar">
                                <i key={i === step ? `${step}-${cycle}` : 'idle'} style={{ animationDuration: `${STEP_MS}ms`, animationPlayState: visible ? 'running' : 'paused' }} />
                            </span>
                        </button>
                    </li>
                ))}
            </ol>
        </div>
    );
}

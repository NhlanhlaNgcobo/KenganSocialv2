import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PublicFooter from '../components/layout/PublicFooter';
import {
    ArrowRight,
    Bot,
    CalendarClock,
    Captions,
    Check,
    ChevronDown,
    Clapperboard,
    Crop,
    Instagram,
    Facebook,
    MessageCircle,
    Megaphone,
    Music2,
    Palette,
    PenLine,
    Play,
    Scissors,
    ShieldCheck,
    Sparkles,
    Upload,
    Wand2,
    Youtube,
} from 'lucide-react';
import LandingNavbar from '../components/layout/LandingNavbar';
import { useAuth } from '../context/AuthContext';
import CaptionShowcase from './Landing/CaptionShowcase';
import LoopVideo from './Landing/LoopVideo';
import TutorialDemo from './Landing/TutorialDemo';
import { useReveal } from './Landing/useReveal';
import './LandingPage.css';

const ROTATING = ['a week of shorts', 'on-brand carousels', 'a launch video', 'scheduled posts'];

const NETWORKS = [
    { icon: Music2, label: 'TikTok' },
    { icon: Instagram, label: 'Instagram Reels' },
    { icon: Youtube, label: 'YouTube Shorts' },
    { icon: Facebook, label: 'Facebook' },
];

/** What each account connection does: platform reviewers check the site explains it. */
const INTEGRATIONS = [
    { icon: Instagram, name: 'Instagram', text: 'Publish Reels you create or schedule, see your account insights, and answer direct messages from one inbox, with automated replies only if you switch them on. Needs a professional account linked to a Facebook Page.' },
    { icon: Facebook, name: 'Facebook Pages', text: 'Publish posts and videos to the Page you choose, and see its follower count.' },
    { icon: Music2, name: 'TikTok', text: 'Post videos to your TikTok account. You pick who can see each post, whether people can comment, duet or stitch, and any content disclosure before it goes out.' },
    { icon: Youtube, name: 'YouTube', text: 'Upload videos and Shorts with the visibility you choose, manage your uploads, read comments and see channel analytics.' },
];

const STEPS = [
    { icon: Upload, title: 'Bring one long video', text: 'Upload a podcast, a livestream or a webinar you recorded. Up to 2 GB.' },
    { icon: Wand2, title: 'Get shorts that are ready to post', text: 'Ranked by how likely they are to hold attention, with faces framed and captions burned in.' },
    { icon: CalendarClock, title: 'Schedule the whole week', text: 'Drop them on the calendar for TikTok, Reels, Shorts and more, from one place.' },
];

const FEATURES = [
    {
        id: 'clips',
        icon: Scissors,
        title: 'Face-tracked shorts',
        text: 'Two people on a podcast? Each gets their own half of the screen. One speaker? The crop follows them.',
        wide: true,
    },
    { id: 'marketing', icon: Megaphone, title: 'Brand kit and carousels', text: 'Paste your website once. Your colours, fonts and voice style every carousel.' },
    { id: 'launch', icon: Clapperboard, title: 'Launch video from a link', text: 'A 15–30 second promo built from your own site, with music and a caption.' },
    { id: 'writer', icon: PenLine, title: 'AI writer', text: 'Captions, hooks and scripts written for each platform.' },
    { id: 'inbox', icon: MessageCircle, title: 'Inbox and automations', text: 'Reply to DMs in one place and turn keywords into leads automatically.' },
];

const STATS = [
    { value: '8', label: 'caption templates' },
    { value: '4', label: 'face-aware layouts' },
    { value: '4', label: 'networks to post to' },
    { value: '10', label: 'shorts from one video' },
];

const PLANS = [
    { name: 'Free', text: 'Video editor, calendar and scheduling to get started.', points: ['Schedule posts', 'Browser video editor', '2 connected accounts'] },
    { name: 'Creator Starter', text: 'Add the AI writer and more posts.', points: ['AI captions and hooks', 'Launch videos', 'More posts and exports'] },
    {
        name: 'Creator Pro',
        text: 'The full shorts machine.',
        points: ['AI clips with face tracking', 'All caption templates', 'Inbox and automations'],
        featured: true,
    },
];

/** Real clips from KenganSocial's renderer (Pexels sample footage in, public/landing out). */
const REEL = [
    { name: 'clip-split', label: 'Two speakers, stacked', meta: 'Bold Pop captions · hook card · TikTok' },
    { name: 'clip-track', label: 'Follows the speaker', meta: 'Highlighter captions · Reels' },
    { name: 'clip-karaoke', label: 'Face kept in frame', meta: 'Karaoke Fill captions · Shorts' },
    { name: 'clip-neon', label: 'Vertical source', meta: 'Neon captions · TikTok' },
];

/** What KenganSocial does, at a glance under the hero. */
const CHIPS = [
    { icon: Scissors, label: 'AI clips' },
    { icon: Crop, label: 'Face-tracked reframe' },
    { icon: Captions, label: 'Animated captions' },
    { icon: Palette, label: 'Brand kit' },
    { icon: CalendarClock, label: 'Scheduling' },
    { icon: MessageCircle, label: 'Inbox and automations' },
    { icon: Megaphone, label: 'Meta Ads' },
];

const FAQ = [
    {
        q: 'What kind of videos work best?',
        a: 'Long videos where people talk: podcasts, interviews, streams, talks and vlogs. Upload an MP4 or MOV of up to 2 GB; KenganSocial finds the strongest moments, keeps faces in frame for vertical video and adds captions.',
    },
    {
        q: 'Is there a free plan?',
        a: 'Yes. The free plan includes the video editor, the content calendar and two connected accounts, with no card needed. New accounts also get a full-access trial, so you can try every feature before deciding.',
    },
    {
        q: 'Where can I post?',
        a: 'TikTok, Instagram, Facebook Pages and YouTube. You connect each one with the platform’s own sign-in, and you can disconnect at any time.',
    },
    {
        q: 'Can I edit the clips myself?',
        a: 'Yes. Open any clip in the video editor to trim it, change the captions, add text, music, transitions and motion, then export or schedule it.',
    },
    {
        q: 'What happens to my videos and data?',
        a: 'Your content stays yours. We handle personal information under POPIA, never sell it and never use your content or your audience’s messages to train AI. Disconnecting an account deletes the data it brought in, and you can delete your account at any time.',
    },
    {
        q: 'How does billing work?',
        a: 'Plans are priced in rand and paid monthly or yearly (yearly saves 10%) through Paystack. Upgrade, downgrade or cancel whenever you like.',
    },
];

/**
 * The hero's main action: drop or choose a long video. Signed-in people go straight to Clips with
 * the file chosen; visitors create a free account first.
 */
function HeroDrop({ user }) {
    const navigate = useNavigate();
    const inputRef = useRef(null);
    const [over, setOver] = useState(false);
    const go = (file) => {
        if (!user) navigate('/register');
        else navigate('/dashboard/clips', file ? { state: { file } } : undefined);
    };
    return (
        <div
            className={`lp-drop ${over ? 'is-over' : ''}`}
            onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                go(e.dataTransfer.files?.[0]);
            }}
        >
            <span className="lp-drop__icon">
                <Upload size={20} />
            </span>
            <span className="lp-drop__text">
                <strong>Drop a long video here</strong>
                <span>Podcast, interview, stream or vlog · MP4 or MOV up to 2 GB</span>
            </span>
            <button type="button" className="btn btn-primary btn-lg lp-cta-btn" onClick={() => (user ? inputRef.current?.click() : go())}>
                Get my clips <ArrowRight size={17} />
            </button>
            <input ref={inputRef} type="file" accept="video/*" hidden onChange={(e) => go(e.target.files?.[0])} />
        </div>
    );
}

/** A slim "start free" bar that appears once the hero has scrolled away (and hides at the final call). */
function StickyCta({ user, primary }) {
    const [show, setShow] = useState(false);
    useEffect(() => {
        const hero = document.querySelector('.lp-hero');
        const final = document.querySelector('.lp-final');
        if (!hero || !('IntersectionObserver' in window)) return undefined;
        const seen = { hero: true, final: false };
        const io = new IntersectionObserver((entries) => {
            for (const e of entries) seen[e.target === hero ? 'hero' : 'final'] = e.isIntersecting;
            setShow(!seen.hero && !seen.final);
        });
        io.observe(hero);
        if (final) io.observe(final);
        return () => io.disconnect();
    }, []);
    return (
        <div className={`lp-sticky ${show ? 'is-shown' : ''}`} aria-hidden={!show}>
            <span>{user ? 'Turn your next long video into shorts' : 'Turn your next long video into a week of shorts. Free to start.'}</span>
            <Link to={user ? '/dashboard/clips' : primary.to} className="btn btn-primary" tabIndex={show ? 0 : -1}>
                {user ? 'Make clips' : primary.label} <ArrowRight size={16} />
            </Link>
        </div>
    );
}

function RotatingWord() {
    const [index, setIndex] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => setIndex((i) => (i + 1) % ROTATING.length), 2600);
        return () => clearInterval(timer);
    }, []);
    return (
        <span className="lp-rotate" aria-live="polite">
            <span key={index} className="lp-rotate__word">
                {ROTATING[index]}
            </span>
        </span>
    );
}

/** Small animated picture for each feature card (pure CSS). */
function FeatureArt({ id }) {
    if (id === 'clips') {
        return (
            <div className="lp-art lp-art--clips lp-art--real" aria-hidden="true">
                <div className="lp-art__wide">
                    <LoopVideo name="studio-wide" className="lp-art__media" />
                </div>
                <ArrowRight className="lp-art__arrow" />
                <div className="lp-art__tall">
                    <LoopVideo name="clip-split" className="lp-art__media" />
                </div>
            </div>
        );
    }
    if (id === 'marketing') {
        return (
            <div className="lp-art lp-art--marketing" aria-hidden="true">
                <div className="lp-art__swatches">
                    <i />
                    <i />
                    <i />
                    <i />
                </div>
                <div className="lp-art__slides">
                    <i />
                    <i />
                    <i />
                </div>
            </div>
        );
    }
    if (id === 'launch') {
        return (
            <div className="lp-art lp-art--launch lp-art--real" aria-hidden="true">
                <LoopVideo name="launch" className="lp-art__media" />
                <span className="lp-art__url">Made with KenganSocial</span>
            </div>
        );
    }
    if (id === 'writer') {
        return (
            <div className="lp-art lp-art--writer" aria-hidden="true">
                <i />
                <i />
                <i />
            </div>
        );
    }
    return (
        <div className="lp-art lp-art--inbox" aria-hidden="true">
            <span className="lp-art__msg">Price for the bundle?</span>
            <span className="lp-art__msg is-reply">
                <Bot size={12} /> Sent you the link 👋
            </span>
            <span className="lp-art__lead">New lead added</span>
        </div>
    );
}

export default function LandingPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const rootRef = useRef(null);
    const [email, setEmail] = useState('');
    useReveal(rootRef);

    const primary = user ? { to: '/dashboard', label: 'Open dashboard' } : { to: '/register', label: 'Start free' };

    const signUp = (e) => {
        e.preventDefault();
        if (user) navigate('/dashboard');
        else navigate('/register', { state: { email: email.trim() } });
    };

    return (
        <div className="landing-page" ref={rootRef}>
            <LandingNavbar />
            <div className="lp-orbs" aria-hidden="true">
                <i />
                <i />
                <i />
            </div>

            <main>
                <section className="lp-hero container">
                    <Link to={primary.to} className="lp-pill" data-reveal>
                        <span className="lp-pill__tag">New</span> Face-tracked shorts for TikTok, Shorts and Reels <ArrowRight size={14} />
                    </Link>
                    <h1 data-reveal>
                        Turn one long video into
                        <br />
                        <RotatingWord />
                    </h1>
                    <p className="lp-lede" data-reveal>
                        KenganSocial finds the best moments in your podcasts and streams, keeps every face in frame, adds captions that pop and puts it all on your
                        calendar. One app for creators, brands and agencies.
                    </p>
                    <div className="lp-actions" data-reveal>
                        <HeroDrop user={user} />
                        <a href="#how" className="lp-watch">
                            <Play size={14} /> Watch how it works
                        </a>
                    </div>
                    <ul className="lp-trust" data-reveal>
                        <li>
                            <Check size={14} /> Free plan, no card
                        </li>
                        <li>
                            <Check size={14} /> Prices in rand
                        </li>
                        <li>
                            <ShieldCheck size={14} /> POPIA-minded data handling
                        </li>
                    </ul>
                    <ul className="lp-chips" data-reveal aria-label="Features">
                        {CHIPS.map((c) => (
                            <li key={c.label}>
                                <c.icon size={14} /> {c.label}
                            </li>
                        ))}
                    </ul>

                    <div className="lp-demo" id="how" data-reveal>
                        <TutorialDemo />
                    </div>
                </section>

                <section className="lp-marquee" aria-label="Networks you can post to">
                    <p>Post to</p>
                    <div className="lp-marquee__track">
                        {[...NETWORKS, ...NETWORKS].map((n, i) => (
                            <span key={`${n.label}-${i}`} className="lp-marquee__item" aria-hidden={i >= NETWORKS.length ? 'true' : undefined}>
                                <n.icon size={18} /> {n.label}
                            </span>
                        ))}
                    </div>
                </section>

                <section className="lp-section container lp-reel" aria-labelledby="reel-title">
                    <header className="lp-section__head" data-reveal>
                        <span className="lp-kicker">Real output</span>
                        <h2 id="reel-title">Made by KenganSocial, not mocked up</h2>
                        <p>Every clip here was cut, framed and captioned by the same engine you get, from an ordinary landscape recording.</p>
                    </header>
                    <div className="lp-reel__row">
                        {REEL.map((r, i) => (
                            <figure key={r.name} className="lp-reel__phone" data-reveal style={{ '--i': i, '--delay': `${i * 110}ms` }}>
                                <div className="lp-reel__screen">
                                    <LoopVideo name={r.name} className="lp-reel__video" label={`Example clip: ${r.label}`} />
                                </div>
                                <figcaption>
                                    <strong>{r.label}</strong>
                                    <span>{r.meta}</span>
                                </figcaption>
                            </figure>
                        ))}
                    </div>
                    <p className="lp-reel__note" data-reveal>
                        Sample footage from Pexels; the people shown are not KenganSocial customers.
                    </p>
                </section>

                <section className="lp-section container" id="integrations" aria-labelledby="integrations-title">
                    <header className="lp-section__head" data-reveal>
                        <span className="lp-kicker">Connected accounts</span>
                        <h2 id="integrations-title">Connect your accounts with each platform’s official sign-in</h2>
                    </header>
                    <div className="lp-integrations">
                        {INTEGRATIONS.map((n, i) => (
                            <article key={n.name} className="lp-integration" data-reveal style={{ '--delay': `${i * 90}ms` }}>
                                <span className="lp-integration__icon">
                                    <n.icon size={18} />
                                </span>
                                <h3>{n.name}</h3>
                                <p>{n.text}</p>
                            </article>
                        ))}
                    </div>
                    <p className="lp-integrations__note" data-reveal>
                        You choose what to allow when you connect, and KenganSocial uses that access only for the features you use. Disconnect any time: we revoke our access and delete the data that connection brought in.
                        See our <Link to="/privacy">Privacy Policy</Link> and <Link to="/data-deletion">Data Deletion</Link> page.
                    </p>
                </section>

                <section className="lp-section container">
                    <header className="lp-section__head" data-reveal>
                        <span className="lp-kicker">How it works</span>
                        <h2>From one recording to a week of content in three steps</h2>
                    </header>
                    <ol className="lp-steps">
                        {STEPS.map((s, i) => (
                            <li key={s.title} className="lp-step" data-reveal style={{ '--delay': `${i * 120}ms` }}>
                                <span className="lp-step__num">{i + 1}</span>
                                <span className="lp-step__icon">
                                    <s.icon size={20} />
                                </span>
                                <h3>{s.title}</h3>
                                <p>{s.text}</p>
                            </li>
                        ))}
                    </ol>
                </section>

                <section className="lp-section container">
                    <header className="lp-section__head" data-reveal>
                        <span className="lp-kicker">Everything in one place</span>
                        <h2>Stop juggling five apps to post one video</h2>
                    </header>
                    <div className="lp-bento">
                        {FEATURES.map((f, i) => (
                            <article key={f.id} className={`lp-feature ${f.wide ? 'is-wide' : ''}`} data-reveal style={{ '--delay': `${(i % 3) * 100}ms` }}>
                                <FeatureArt id={f.id} />
                                <div className="lp-feature__text">
                                    <span className="lp-feature__icon">
                                        <f.icon size={17} />
                                    </span>
                                    <h3>{f.title}</h3>
                                    <p>{f.text}</p>
                                </div>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="lp-section container lp-split">
                    <div className="lp-split__text" data-reveal>
                        <span className="lp-kicker">Captions</span>
                        <h2>Captions people actually read</h2>
                        <p>
                            Eight templates, from bold word-by-word pops to clean subtitles. Every word is timed to speech, kept clear of each app's buttons and burned
                            into the video, so it looks right everywhere.
                        </p>
                        <Link to={primary.to} className="btn btn-primary">
                            Try it on your video <ArrowRight size={16} />
                        </Link>
                    </div>
                    <div data-reveal style={{ '--delay': '120ms' }}>
                        <CaptionShowcase />
                    </div>
                </section>

                <section className="lp-stats container" aria-label="In numbers">
                    {STATS.map((s, i) => (
                        <div key={s.label} className="lp-stat" data-reveal style={{ '--delay': `${i * 90}ms` }}>
                            <strong>{s.value}</strong>
                            <span>{s.label}</span>
                        </div>
                    ))}
                </section>

                <section className="lp-section container">
                    <header className="lp-section__head" data-reveal>
                        <span className="lp-kicker">Plans</span>
                        <h2>Start free. Upgrade when it pays for itself.</h2>
                    </header>
                    <div className="lp-plans">
                        {PLANS.map((p, i) => (
                            <article key={p.name} className={`lp-plan ${p.featured ? 'is-featured' : ''}`} data-reveal style={{ '--delay': `${i * 100}ms` }}>
                                {p.featured ? (
                                    <span className="lp-plan__badge">
                                        <Sparkles size={12} /> Recommended
                                    </span>
                                ) : null}
                                <h3>{p.name}</h3>
                                <p>{p.text}</p>
                                <ul>
                                    {p.points.map((pt) => (
                                        <li key={pt}>
                                            <Check size={14} /> {pt}
                                        </li>
                                    ))}
                                </ul>
                            </article>
                        ))}
                    </div>
                    <p className="lp-plans__more" data-reveal>
                        <Link to="/pricing">
                            Compare all plans and prices <ArrowRight size={14} />
                        </Link>
                    </p>
                </section>

                <section className="lp-section container" aria-labelledby="faq-title">
                    <header className="lp-section__head" data-reveal>
                        <span className="lp-kicker">Questions</span>
                        <h2 id="faq-title">Good to know</h2>
                    </header>
                    <div className="lp-faq">
                        {FAQ.map((f, i) => (
                            <details key={f.q} className="lp-faq__item" data-reveal style={{ '--delay': `${i * 60}ms` }}>
                                <summary>
                                    {f.q}
                                    <ChevronDown size={18} aria-hidden="true" />
                                </summary>
                                <p>{f.a}</p>
                            </details>
                        ))}
                    </div>
                </section>

                <section className="lp-final container" data-reveal>
                    <div className="lp-final__glow" aria-hidden="true" />
                    <h2>Your next week of content is already recorded.</h2>
                    <p>Create a free account and turn your latest video into shorts today.</p>
                    {user ? (
                        <Link to="/dashboard" className="btn btn-primary btn-lg lp-cta-btn">
                            Open dashboard <ArrowRight size={17} />
                        </Link>
                    ) : (
                        <form className="lp-signup" onSubmit={signUp}>
                            <label htmlFor="lp-email" className="sr-only">
                                Email address
                            </label>
                            <input
                                id="lp-email"
                                className="input"
                                type="email"
                                placeholder="you@yourbrand.co.za"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                autoComplete="email"
                            />
                            <button type="submit" className="btn btn-primary btn-lg lp-cta-btn">
                                Start free <ArrowRight size={17} />
                            </button>
                        </form>
                    )}
                    <small>Free plan. No card needed. Cancel anytime.</small>
                </section>
            </main>

            <StickyCta user={user} primary={primary} />
            <PublicFooter />
        </div>
    );
}

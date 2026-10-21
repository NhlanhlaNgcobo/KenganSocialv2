import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PublicFooter from '../components/layout/PublicFooter';
import {
    ArrowRight,
    Bot,
    CalendarClock,
    Check,
    Clapperboard,
    Instagram,
    Facebook,
    MessageCircle,
    Megaphone,
    Music2,
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

const STEPS = [
    { icon: Upload, title: 'Bring one long video', text: 'A podcast, a livestream, a webinar or a YouTube link. Up to 2 GB.' },
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
    { value: '6', label: 'networks to post to' },
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
            <div className="lp-art lp-art--clips" aria-hidden="true">
                <div className="lp-art__wide">
                    <i className="lp-art__face" />
                    <i className="lp-art__face" />
                </div>
                <ArrowRight className="lp-art__arrow" />
                <div className="lp-art__tall">
                    <i className="lp-art__face" />
                    <span>WAIT FOR IT</span>
                    <i className="lp-art__face" />
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
            <div className="lp-art lp-art--launch" aria-hidden="true">
                <span className="lp-art__url">yourbrand.co.za</span>
                <span className="lp-art__play">
                    <Play size={16} />
                </span>
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
                        Kengan Social finds the best moments in your podcasts and streams, keeps every face in frame, adds captions that pop and puts it all on your
                        calendar. One app for creators, brands and agencies.
                    </p>
                    <div className="lp-actions" data-reveal>
                        <Link to={primary.to} className="btn btn-primary btn-lg lp-cta-btn">
                            {primary.label} <ArrowRight size={17} />
                        </Link>
                        <a href="#how" className="btn btn-secondary btn-lg">
                            <Play size={16} /> Watch how it works
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
                                        <Sparkles size={12} /> Most popular
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

            <PublicFooter />
        </div>
    );
}

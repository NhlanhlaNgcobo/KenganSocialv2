import { Link } from 'react-router-dom';
import { ArrowRight, CalendarClock, Clapperboard, Scissors } from 'lucide-react';
import LandingNavbar from '../components/layout/LandingNavbar';
import { useAuth } from '../context/AuthContext';
import './LandingPage.css';

const FEATURES = [
    {
        icon: Scissors,
        title: 'Edit video in the browser',
        body: 'A multi-track timeline with trimming, captions, speed, filters, stabilization and auto-framing to 9:16. Export an MP4 when you are done.',
        shot: '/screens/editor.png',
        alt: 'The KenganSocial video editor with a timeline, preview and clip settings',
    },
    {
        icon: Clapperboard,
        title: 'Make a launch video from a link',
        body: 'Paste a website address and get a 15–30 second promo built from its own copy, colours and screenshots, with music and a ready-to-post caption.',
        shot: '/screens/launch.png',
        alt: 'The launch video page showing a finished video, caption and storyboard',
    },
    {
        icon: CalendarClock,
        title: 'Plan and schedule posts',
        body: 'Lay out the month on a calendar and schedule to TikTok, Instagram, YouTube, LinkedIn, Pinterest and Threads from one place.',
        shot: '/screens/scheduler.png',
        alt: 'The content calendar with scheduled posts',
    },
];

export default function LandingPage() {
    const { user } = useAuth();
    const primary = user ? { to: '/dashboard', label: 'Open dashboard' } : { to: '/register', label: 'Start for free' };

    return (
        <div className="landing-page">
            <LandingNavbar />

            <main>
                <section className="lp-hero container">
                    <p className="lp-eyebrow">For creators, brands and small agencies</p>
                    <h1>
                        Edit, schedule and post
                        <br />
                        your videos in one place.
                    </h1>
                    <p className="lp-lede">
                        KenganSocial is a video editor, content calendar and inbox for short-form social. Cut a clip, caption it and schedule it without
                        switching apps.
                    </p>
                    <div className="lp-actions">
                        <Link to={primary.to} className="btn btn-primary btn-lg">
                            {primary.label} <ArrowRight size={17} />
                        </Link>
                        <Link to="/pricing" className="btn btn-secondary btn-lg">
                            See pricing
                        </Link>
                    </div>
                    <p className="lp-note">Prices in rand. No card needed to start.</p>

                    <div className="lp-shot lp-shot--hero">
                        <img src="/screens/editor.png" alt="The KenganSocial video editor" loading="eager" />
                    </div>
                </section>

                <section className="lp-features container" aria-label="What you can do">
                    {FEATURES.map((f, i) => (
                        <article key={f.title} className={`lp-feature ${i % 2 ? 'is-flipped' : ''}`}>
                            <div className="lp-feature__text">
                                <span className="lp-feature__icon">
                                    <f.icon size={18} />
                                </span>
                                <h2>{f.title}</h2>
                                <p>{f.body}</p>
                            </div>
                            <div className="lp-shot">
                                <img src={f.shot} alt={f.alt} loading="lazy" />
                            </div>
                        </article>
                    ))}
                </section>

                <section className="lp-cta container">
                    <h2>Start with the free plan.</h2>
                    <p>Upgrade when you need AI captions, auto-edit and more exports.</p>
                    <Link to={primary.to} className="btn btn-primary btn-lg">
                        {primary.label} <ArrowRight size={17} />
                    </Link>
                </section>
            </main>

            <footer className="lp-footer container">
                <span>© {new Date().getFullYear()} KenganSocial</span>
                <nav>
                    <Link to="/about">About</Link>
                    <Link to="/help">Help</Link>
                    <Link to="/privacy">Privacy</Link>
                    <Link to="/legal">Terms</Link>
                </nav>
            </footer>
        </div>
    );
}

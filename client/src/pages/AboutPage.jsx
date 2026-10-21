import { useRef } from 'react';
import { Link } from 'react-router-dom';
import {
    ArrowRight,
    BarChart3,
    Briefcase,
    CalendarClock,
    Code2,
    KeyRound,
    MessageCircle,
    Scissors,
    ShieldCheck,
    Store,
    Trash2,
    UserRound,
} from 'lucide-react';
import PublicFooter from '../components/layout/PublicFooter';
import LandingNavbar from '../components/layout/LandingNavbar';
import { COMPANY } from '../content/legal';
import { useReveal } from './Landing/useReveal';
import './LandingPage.css';
import './About.css';

const WHAT_IT_DOES = [
    {
        icon: Scissors,
        title: 'Create',
        text: 'Turn podcasts, streams and YouTube links into face-tracked shorts with captions. Edit in the browser, build carousels from your brand kit and write captions with AI.',
    },
    {
        icon: CalendarClock,
        title: 'Publish',
        text: 'Connect TikTok, Instagram, Facebook Pages and YouTube, then post now or schedule from one calendar. Every post goes out through each platform’s official API.',
    },
    {
        icon: MessageCircle,
        title: 'Engage',
        text: 'Answer comments and direct messages from one inbox. Set keyword automations that reply for you and save interested people as leads.',
    },
    {
        icon: BarChart3,
        title: 'Learn',
        text: 'See how each post and account performs, spot what is trending in your niche and plan the next week around it.',
    },
];

const WHO = [
    { icon: UserRound, title: 'Creators', text: 'One recording becomes a week of posts, without paying for five separate tools.' },
    { icon: Store, title: 'Small businesses', text: 'Stay visible on every network and answer customers quickly, with prices in rand.' },
    {
        icon: Briefcase,
        title: 'Agencies',
        text: 'Run each client in its own workspace, invite your team and send posts to clients for approval before they go live.',
    },
];

const PRINCIPLES = [
    { icon: KeyRound, title: 'Your accounts, your permission', text: 'We use official sign-in only and never ask for your social media passwords. Before you connect, we explain what each platform will ask for and why.' },
    { icon: ShieldCheck, title: 'Your data stays yours', text: 'We do not sell personal information or use your audience’s messages to advertise. Each workspace is kept separate from every other.' },
    { icon: Trash2, title: 'Leave whenever you like', text: 'Disconnect an account to revoke our access, or delete your whole account in Settings. We remove the data as our Privacy Policy describes.' },
];

export default function AboutPage() {
    const rootRef = useRef(null);
    useReveal(rootRef);

    return (
        <div className="landing-page" ref={rootRef}>
            <LandingNavbar />
            <div className="lp-orbs" aria-hidden="true">
                <i />
                <i />
                <i />
            </div>

            <main>
                <section className="lp-section container about-hero">
                    <header className="lp-section__head" data-reveal>
                        <span className="lp-kicker">About {COMPANY.product}</span>
                        <h1>One place to create, post and reply on social media</h1>
                        <p className="about-lede">
                            {COMPANY.product} helps creators, businesses and agencies turn long videos into short ones, publish them to every network on a
                            schedule, and keep up with the comments and messages that follow. It is built in South Africa by{' '}
                            <a href={COMPANY.operatorSite} target="_blank" rel="noreferrer">
                                {COMPANY.operator}
                            </a>
                            .
                        </p>
                    </header>
                </section>

                <section className="lp-section container about-section">
                    <header className="lp-section__head" data-reveal>
                        <span className="lp-kicker">Why we built it</span>
                        <h2>Posting one video shouldn’t take five apps</h2>
                    </header>
                    <div className="about-prose" data-reveal>
                        <p>
                            Most people who post on social media do the same work every week: cut a long recording into clips, add captions, write a
                            caption for each network, upload to each app one by one, and then answer the same questions in comments and messages. Each
                            step usually lives in a different tool, and each tool is priced in dollars.
                        </p>
                        <p>
                            {COMPANY.product} puts those steps in one workspace. You bring the video and decide what goes out and when. The app handles the
                            repetitive parts, and you stay in control of every account you connect.
                        </p>
                    </div>
                </section>

                <section className="lp-section container about-section">
                    <header className="lp-section__head" data-reveal>
                        <span className="lp-kicker">What it does</span>
                        <h2>From recording to replies</h2>
                    </header>
                    <ul className="lp-steps about-grid about-grid--4">
                        {WHAT_IT_DOES.map((item, i) => (
                            <li key={item.title} className="lp-step" data-reveal style={{ '--delay': `${i * 100}ms` }}>
                                <span className="lp-step__icon">
                                    <item.icon size={20} />
                                </span>
                                <h3>{item.title}</h3>
                                <p>{item.text}</p>
                            </li>
                        ))}
                    </ul>
                </section>

                <section className="lp-section container about-section">
                    <header className="lp-section__head" data-reveal>
                        <span className="lp-kicker">Who it’s for</span>
                        <h2>Made for people who post for a living</h2>
                    </header>
                    <ul className="lp-steps about-grid">
                        {WHO.map((item, i) => (
                            <li key={item.title} className="lp-step" data-reveal style={{ '--delay': `${i * 100}ms` }}>
                                <span className="lp-step__icon">
                                    <item.icon size={20} />
                                </span>
                                <h3>{item.title}</h3>
                                <p>{item.text}</p>
                            </li>
                        ))}
                    </ul>
                </section>

                <section className="lp-section container about-section">
                    <header className="lp-section__head" data-reveal>
                        <span className="lp-kicker">How we handle your accounts</span>
                        <h2>Trust comes first</h2>
                    </header>
                    <ul className="lp-steps about-grid">
                        {PRINCIPLES.map((item, i) => (
                            <li key={item.title} className="lp-step" data-reveal style={{ '--delay': `${i * 100}ms` }}>
                                <span className="lp-step__icon">
                                    <item.icon size={20} />
                                </span>
                                <h3>{item.title}</h3>
                                <p>{item.text}</p>
                            </li>
                        ))}
                    </ul>
                    <p className="about-links" data-reveal>
                        Read the <Link to="/privacy">Privacy Policy</Link>, <Link to="/terms">Terms of Service</Link> and{' '}
                        <Link to="/data-deletion">how to delete your data</Link>. We handle personal information in line with the Protection of
                        Personal Information Act (POPIA).
                    </p>
                </section>

                <section className="lp-section container about-section">
                    <div className="about-company" data-reveal>
                        <span className="lp-step__icon">
                            <Code2 size={20} />
                        </span>
                        <div>
                            <span className="lp-kicker">Who we are</span>
                            <h2>Built by {COMPANY.operator}</h2>
                            <p>
                                {COMPANY.operator} is a South African company that builds software and apps. {COMPANY.product} is one of its products, and{' '}
                                {COMPANY.operator} is the company responsible for it and for the personal information it handles.
                            </p>
                            <dl className="about-facts">
                                <div>
                                    <dt>Location</dt>
                                    <dd>{COMPANY.address}</dd>
                                </div>
                                <div>
                                    <dt>Website</dt>
                                    <dd>
                                        <a href={COMPANY.operatorSite} target="_blank" rel="noreferrer">
                                            {COMPANY.operatorSite.replace(/^https:\/\//, '')}
                                        </a>
                                    </dd>
                                </div>
                                <div>
                                    <dt>Support</dt>
                                    <dd>
                                        <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>
                                    </dd>
                                </div>
                                <div>
                                    <dt>Privacy</dt>
                                    <dd>
                                        <a href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</a>
                                    </dd>
                                </div>
                            </dl>
                        </div>
                    </div>
                </section>

                <section className="lp-section container about-section about-cta" data-reveal>
                    <h2>Try it free</h2>
                    <p>The free plan includes the video editor, the calendar and two connected accounts. No card needed.</p>
                    <Link to="/register" className="btn btn-primary btn-lg">
                        Start free <ArrowRight size={17} />
                    </Link>
                </section>
            </main>
            <PublicFooter />
        </div>
    );
}

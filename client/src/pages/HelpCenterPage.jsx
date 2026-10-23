import PublicFooter from '../components/layout/PublicFooter';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import LandingNavbar from '../components/layout/LandingNavbar';
import { Search, Mail, BookOpen } from 'lucide-react';
import { BILLING_EMAIL } from '../utils/planLimits';
import './LandingPage.css';

const SUPPORT_EMAIL = 'support@kengansocial.co.za';
const PRIVACY_EMAIL = 'privacy@kengansocial.co.za';

const FAQ = [
    {
        q: 'How do I connect a social account?',
        a: 'Open Connections in your dashboard and choose Connect next to the platform. You sign in with that platform and approve access. Instagram, Facebook Pages, TikTok and YouTube are supported.',
    },
    {
        q: 'How do I schedule a post?',
        a: 'Create the post in Content Studio or the video editor, then pick a date and time on the Calendar. It publishes to the accounts you connected.',
    },
    {
        q: 'Which plan do I need for the AI tools?',
        a: 'The Free plan covers scheduling and video exports. AI captions, generations and renders need a paid plan. The Pricing page lists what each plan includes.',
    },
    {
        q: 'How do I upgrade?',
        a: 'Open Billing in your dashboard, choose a plan and pay through Payfast. Your plan changes as soon as the payment is confirmed.',
    },
    {
        q: 'How do I cancel or change my plan?',
        a: `Email ${BILLING_EMAIL}. Paid plans run until the end of the period you paid for.`,
    },
    {
        q: 'When do usage limits reset?',
        a: 'Monthly counters (posts, exports, AI credits, renders, transcription hours) reset on the 1st of each month at 00:00 UTC.',
    },
    {
        q: 'What is an AI credit?',
        a: 'One AI text generation (a caption, hooks, a script, a repurpose run or a carousel’s writing) uses 1 credit. AI images cost more to make: each fast image uses 2 credits and each best-quality image 6. Free images use no extra credits. Transcription is counted in hours of video, rounded up per video.',
    },
    {
        q: 'Where do I set up my brand kit?',
        a: 'In the dashboard under Marketing → Brand.',
    },
    {
        q: 'How do I delete my workspace or my data?',
        a: `Email ${PRIVACY_EMAIL} from the address on your account. We confirm the request and delete the data as required by POPIA.`,
    },
];

const cardStyle = { padding: '40px', borderTop: '4px solid var(--accent-primary)', display: 'flex', flexDirection: 'column', alignItems: 'center' };
const iconWrapStyle = { background: 'var(--bg-hover)', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' };

export default function HelpCenterPage() {
    const [query, setQuery] = useState('');

    const results = useMemo(() => {
        const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (!terms.length) return FAQ;
        return FAQ.filter((item) => {
            const text = `${item.q} ${item.a}`.toLowerCase();
            return terms.every((t) => text.includes(t));
        });
    }, [query]);

    return (
        <div className="landing-page bg-primary" style={{ minHeight: '100vh', paddingBottom: '100px' }}>
            <div className="bg-grid absolute-inset" />
            <div className="bg-glow absolute-inset" />

            <LandingNavbar />

            <main className="container animate-slide-in" style={{ marginTop: '120px', position: 'relative', zIndex: 10 }}>

                <div style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
                    <div className="badge badge-brand" style={{ margin: '0 auto 24px' }}>
                        <span className="badge-dot" /> Support & Resources
                    </div>

                    <h1 style={{ fontSize: '3rem', fontWeight: '800', marginBottom: '24px', lineHeight: '1.2' }}>
                        How can we <span className="text-gradient">help you?</span>
                    </h1>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '32px', textAlign: 'center', maxWidth: '800px', margin: '0 auto 64px' }}>
                    <div className="card glass animate-fade-in delay-1" style={cardStyle}>
                        <div style={iconWrapStyle}>
                            <BookOpen size={28} className="text-brand" />
                        </div>
                        <h3 style={{ fontSize: '1.4rem', marginBottom: '16px' }}>Getting Started</h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: '1.6' }}>Set up your workspace, connect accounts and schedule your first post.</p>
                        <a className="btn btn-secondary" style={{ marginTop: 'auto', width: '100%', textDecoration: 'none', justifyContent: 'center' }} href="#faq">
                            Read the FAQ
                        </a>
                    </div>

                    <div className="card glass animate-fade-in delay-2" style={cardStyle}>
                        <div style={iconWrapStyle}>
                            <Mail size={28} className="text-brand" />
                        </div>
                        <h3 style={{ fontSize: '1.4rem', marginBottom: '16px' }}>Contact Support</h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: '1.6' }}>Found a bug or a scheduling error? Email us and we'll get back to you.</p>
                        <a
                            className="btn btn-primary"
                            style={{ marginTop: '24px', width: '100%', textDecoration: 'none', justifyContent: 'center' }}
                            href={`mailto:${SUPPORT_EMAIL}?subject=KenganSocial%20support%20request`}
                        >
                            Email Team
                        </a>
                    </div>
                </div>

                <section id="faq" style={{ maxWidth: '800px', margin: '0 auto', scrollMarginTop: '100px' }}>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 800, marginBottom: '20px', textAlign: 'center' }}>Frequently asked questions</h2>

                    <label className="card glass" style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', border: '1px solid var(--border-color)', borderRadius: '100px', marginBottom: '24px' }}>
                        <Search size={20} className="text-muted" style={{ marginRight: '16px', flexShrink: 0 }} />
                        <input
                            type="search"
                            placeholder="Search the FAQ…"
                            aria-label="Search the FAQ"
                            className="input"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            style={{ background: 'transparent', border: 'none', width: '100%', fontSize: '1rem', padding: '12px 0' }}
                        />
                    </label>

                    {results.length === 0 ? (
                        <p style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>
                            No answers match "{query.trim()}". <a href={`mailto:${SUPPORT_EMAIL}?subject=KenganSocial%20support%20request`} style={{ color: 'var(--accent-text)' }}>Email us</a> instead.
                        </p>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {results.map((item) => (
                                <details key={item.q} className="card" style={{ padding: '18px 22px' }}>
                                    <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{item.q}</summary>
                                    <p style={{ color: 'var(--text-secondary)', lineHeight: '1.7', marginTop: '12px' }}>{item.a}</p>
                                </details>
                            ))}
                        </div>
                    )}

                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '32px', textAlign: 'center' }}>
                        See also <Link to="/pricing" style={{ color: 'var(--accent-text)' }}>Pricing</Link>, <Link to="/privacy" style={{ color: 'var(--accent-text)' }}>Privacy</Link> and <Link to="/terms" style={{ color: 'var(--accent-text)' }}>Terms</Link>.
                    </p>
                </section>
            </main>
            <PublicFooter />
        </div>
    );
}

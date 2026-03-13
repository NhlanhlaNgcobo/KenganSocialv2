import LandingNavbar from '../components/layout/LandingNavbar';
import './LandingPage.css';

export default function AboutPage() {
    return (
        <div className="landing-page bg-primary" style={{ minHeight: '100vh', paddingBottom: '100px' }}>
            <div className="bg-grid absolute-inset" />
            <div className="bg-glow absolute-inset" />

            <LandingNavbar />

            <main className="container animate-slide-in" style={{ marginTop: '120px', position: 'relative', zIndex: 10 }}>
                <div style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
                    <div className="badge badge-brand" style={{ margin: '0 auto 24px' }}>
                        <span className="badge-dot" /> Our Vision
                    </div>

                    <h1 style={{ fontSize: '3rem', fontWeight: '800', marginBottom: '24px', lineHeight: '1.2' }}>
                        Democratizing Social Media <span className="text-gradient">Growth</span>
                    </h1>

                    <p style={{ color: 'var(--text-secondary)', fontSize: '1.2rem', marginBottom: '48px', lineHeight: '1.6' }}>
                        We believe that powerful social media automation shouldn't be locked behind enterprise-level paywalls. KenganSocial was born from the frustration of bouncing between separate apps to edit videos, generate captions, and schedule posts.
                    </p>
                </div>

                <div className="card glass animate-fade-in delay-1" style={{ padding: '60px', maxWidth: '800px', margin: '0 auto', textAlign: 'left' }}>
                    <h3 style={{ fontSize: '1.8rem', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ color: 'var(--accent-primary)', fontSize: '2rem' }}>&bull;</span> The Story
                    </h3>
                    <p style={{ color: 'var(--text-secondary)', lineHeight: '1.8', marginBottom: '24px', fontSize: '1.1rem' }}>
                        What started as an internal tool to manage multiple agency clients quickly evolved into something much larger. We realized that creators, small businesses, and massive enterprises all face the same bottleneck: <strong>content friction</strong>.
                    </p>
                    <p style={{ color: 'var(--text-secondary)', lineHeight: '1.8', marginBottom: '48px', fontSize: '1.1rem' }}>
                        By combining cutting edge AI models with intuitive drag-and-drop scheduling workflows, we built KenganSocial to remove that friction completely. Generate captions while your video renders, queue it up for next Tuesday, and let our engine handle the rest.
                    </p>

                    <h3 style={{ fontSize: '1.8rem', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ color: 'var(--accent-primary)', fontSize: '2rem' }}>&bull;</span> Our Mission
                    </h3>
                    <p style={{ color: 'var(--text-secondary)', lineHeight: '1.8', fontSize: '1.1rem' }}>
                        To give every creator the operational scale of a massive media agency, powered by uncompromising technology.
                    </p>
                </div>
            </main>
        </div>
    );
}

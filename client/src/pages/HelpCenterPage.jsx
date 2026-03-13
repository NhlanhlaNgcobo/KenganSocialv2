import LandingNavbar from '../components/layout/LandingNavbar';
import { Search, Mail, BookOpen, MessageCircle } from 'lucide-react';
import './LandingPage.css';

export default function HelpCenterPage() {
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

                    <div className="card glass animate-fade-in delay-1" style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', marginBottom: '64px', border: '1px solid var(--border-color)', borderRadius: '100px', maxWidth: '600px', margin: '0 auto 64px' }}>
                        <Search size={20} className="text-muted" style={{ marginRight: '16px' }} />
                        <input
                            type="text"
                            placeholder="Search guides, tutorials, and workflows..."
                            className="input"
                            style={{ background: 'transparent', border: 'none', width: '100%', fontSize: '1rem', padding: '12px 0' }}
                        />
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '32px', textAlign: 'center' }}>
                    {/* Component 1 */}
                    <div className="card glass animate-fade-in delay-1" style={{ padding: '40px', borderTop: '4px solid var(--accent-primary)', cursor: 'pointer', transition: 'transform 0.2s', ':hover': { transform: 'translateY(-5px)' } }}>
                        <div style={{ background: 'rgba(255,255,255,0.05)', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
                            <BookOpen size={28} className="text-brand" />
                        </div>
                        <h3 style={{ fontSize: '1.4rem', marginBottom: '16px' }}>Getting Started</h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: '1.6' }}>Learn the basics of setting up workspaces and connecting accounts.</p>
                    </div>

                    {/* Component 2 */}
                    <div className="card glass animate-fade-in delay-2" style={{ padding: '40px', borderTop: '4px solid var(--accent-primary)', cursor: 'pointer', transition: 'transform 0.2s', ':hover': { transform: 'translateY(-5px)' } }}>
                        <div style={{ background: 'rgba(255,255,255,0.05)', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
                            <MessageCircle size={28} className="text-brand" />
                        </div>
                        <h3 style={{ fontSize: '1.4rem', marginBottom: '16px' }}>Community Forms</h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: '1.6' }}>See workflows from top agencies, request specific integrations, and talk strategy.</p>
                    </div>

                    {/* Component 3 */}
                    <div className="card glass animate-fade-in delay-3" style={{ padding: '40px', borderTop: '4px solid var(--accent-primary)', cursor: 'pointer', transition: 'transform 0.2s', ':hover': { transform: 'translateY(-5px)' } }}>
                        <div style={{ background: 'rgba(255,255,255,0.05)', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
                            <Mail size={28} className="text-brand" />
                        </div>
                        <h3 style={{ fontSize: '1.4rem', marginBottom: '16px' }}>Contact Support</h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: '1.6' }}>Encountered a bug or scheduling error? Open a direct ticket with engineering.</p>
                        <button className="btn btn-primary" style={{ marginTop: '24px', width: '100%' }}>Email Team</button>
                    </div>
                </div>
            </main>
        </div>
    );
}

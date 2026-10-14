import { Link } from 'react-router-dom';
import LandingNavbar from '../components/layout/LandingNavbar';
import { useAuth } from '../context/AuthContext';
import { Check, X } from 'lucide-react';
import './LandingPage.css'; // Reusing for background styles

export default function PricingPage() {
    const { user } = useAuth();
    // Signed-in users upgrade from Billing; visitors start by creating an account.
    const startUrl = user ? '/dashboard/billing' : '/register';
    const linkStyle = { width: '100%', marginBottom: '32px', textDecoration: 'none' };

    return (
        <div className="landing-page bg-primary" style={{ minHeight: '100vh', paddingBottom: '100px' }}>
            <div className="bg-grid absolute-inset" />
            <div className="bg-glow absolute-inset" />

            <LandingNavbar />

            <main className="container animate-slide-in" style={{ marginTop: '120px', position: 'relative', zIndex: 10, textAlign: 'center' }}>
                <div className="badge badge-brand" style={{ margin: '0 auto 24px' }}>
                    <span className="badge-dot" /> Monthly, in rand
                </div>
                <h1 style={{ fontSize: '3rem', fontWeight: '800', marginBottom: '24px', lineHeight: '1.2' }}>
                    Pricing
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '1.2rem', maxWidth: '600px', margin: '0 auto 64px' }}>
                    Start free. Upgrade for AI captions, auto-edit, more exports and more connected accounts. Cancel any time.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '32px', textAlign: 'left' }}>

                    {/* Creator Starter Plan */}
                    <div className="card glass animate-fade-in delay-1" style={{ padding: '40px', borderTop: '4px solid var(--border-color)' }}>
                        <h3 style={{ fontSize: '1.5rem', marginBottom: '16px' }}>Creator Starter</h3>
                        <div style={{ fontSize: '3rem', fontWeight: '800', marginBottom: '8px' }}>
                            R249<span style={{ fontSize: '1rem', color: 'var(--text-secondary)', fontWeight: '400' }}>/mo</span>
                        </div>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '32px', fontSize: '14px' }}>Perfect for individuals getting started with social automation.</p>

                        <Link to={startUrl} className="btn btn-secondary" style={linkStyle}>Start Free Trial</Link>

                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}><Check size={18} className="text-brand" /> 1 account per platform (max 4)</li>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}><Check size={18} className="text-brand" /> 1,000 AI credits/month</li>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}><Check size={18} className="text-brand" /> 3 automation rules</li>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}><Check size={18} className="text-brand" /> Basic analytics</li>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}><Check size={18} className="text-brand" /> Standard processing speed</li>
                        </ul>
                    </div>

                    {/* Creator Pro Plan */}
                    <div className="card glass animate-fade-in delay-2" style={{ padding: '40px', borderTop: '4px solid var(--accent-primary)', position: 'relative', transform: 'scale(1.05)', zIndex: 1 }}>
                        <div style={{ position: 'absolute', top: '-14px', left: '50%', transform: 'translateX(-50%)', background: 'var(--accent-primary)', color: '#000', padding: '4px 16px', borderRadius: '100px', fontSize: '12px', fontWeight: '700', letterSpacing: '0.05em' }}>
                            MOST POPULAR
                        </div>
                        <h3 style={{ fontSize: '1.5rem', marginBottom: '16px' }}>Creator Pro</h3>
                        <div style={{ fontSize: '3rem', fontWeight: '800', marginBottom: '8px' }}>
                            R499<span style={{ fontSize: '1rem', color: 'var(--text-secondary)', fontWeight: '400' }}>/mo</span>
                        </div>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '32px', fontSize: '14px' }}>Everything you need to grow your brand aggressively.</p>

                        <Link to={startUrl} className="btn btn-primary" style={linkStyle}>Get Started</Link>

                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}><Check size={18} className="text-brand" /> Up to 3 accounts per platform (max 12)</li>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}><Check size={18} className="text-brand" /> 5,000 AI credits/month</li>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}><Check size={18} className="text-brand" /> Unlimited automation rules</li>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}><Check size={18} className="text-brand" /> Priority processing</li>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}><Check size={18} className="text-brand" /> Advanced analytics</li>
                        </ul>
                    </div>

                    {/* Agency Plan */}
                    <div className="card glass animate-fade-in delay-3" style={{ padding: '40px', borderTop: '4px solid var(--border-color)' }}>
                        <h3 style={{ fontSize: '1.5rem', marginBottom: '16px' }}>Agency Plan</h3>
                        <div style={{ fontSize: '3rem', fontWeight: '800', marginBottom: '8px' }}>
                            R3199<span style={{ fontSize: '1rem', color: 'var(--text-secondary)', fontWeight: '400' }}>/mo</span>
                        </div>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '32px', fontSize: '14px' }}>For teams managing multiple clients at scale.</p>

                        <Link to={startUrl} className="btn btn-secondary" style={linkStyle}>Get Started</Link>

                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}><Check size={18} className="text-brand" /> Up to 10 accounts per platform (max 40)</li>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}><Check size={18} className="text-brand" /> 20,000 AI credits/month</li>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}><Check size={18} className="text-brand" /> Team access (3 seats)</li>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}><Check size={18} className="text-brand" /> CRM export</li>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}><Check size={18} className="text-brand" /> Client reporting dashboard</li>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}><Check size={18} className="text-brand" /> Faster compute queue</li>
                        </ul>
                    </div>

                    {/* Enterprise Plan */}
                    <div className="card glass animate-fade-in delay-4" style={{ padding: '40px', borderTop: '4px solid var(--border-color)' }}>
                        <h3 style={{ fontSize: '1.5rem', marginBottom: '16px' }}>Enterprise</h3>
                        <div style={{ fontSize: '2.5rem', fontWeight: '800', marginBottom: '16px', lineHeight: '1.2' }}>
                            Custom Pricing
                        </div>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '32px', fontSize: '14px' }}>For large-scale operations and custom requirements.</p>

                        <a href="mailto:info@kengansocial.com?subject=Enterprise%20plan%20enquiry" className="btn btn-secondary" style={linkStyle}>Contact Us</a>

                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}><Check size={18} className="text-brand" /> 30+ accounts per platform</li>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}><Check size={18} className="text-brand" /> 50,000+ AI credits</li>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}><Check size={18} className="text-brand" /> White label</li>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}><Check size={18} className="text-brand" /> Dedicated compute</li>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}><Check size={18} className="text-brand" /> SLA support</li>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}><Check size={18} className="text-brand" /> 5+ team members</li>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}><Check size={18} className="text-brand" /> Custom integrations</li>
                        </ul>
                    </div>
                </div>
            </main>
        </div>
    );
}

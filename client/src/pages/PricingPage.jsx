import PublicFooter from '../components/layout/PublicFooter';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import LandingNavbar from '../components/layout/LandingNavbar';
import { useAuth } from '../context/AuthContext';
import { Check } from 'lucide-react';
import { BILLING_EMAIL, fetchPlanCatalog, formatZar } from '../utils/planLimits';
// Built from the server's catalog (scripts/build-plan-catalog.mjs): prices show even when the API is down.
import BUILT_IN_CATALOG from '../content/plan-catalog.json';
import './LandingPage.css'; // Reusing for background styles

const listStyle = { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' };
const itemStyle = { display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' };
const linkStyle = { width: '100%', marginBottom: '32px', textDecoration: 'none', justifyContent: 'center' };

export default function PricingPage() {
    const { user } = useAuth();
    const [catalog, setCatalog] = useState(BUILT_IN_CATALOG);

    // The live catalog replaces the built-in copy when the API answers; otherwise the copy stays.
    useEffect(() => {
        let cancelled = false;
        fetchPlanCatalog()
            .then((data) => {
                if (!cancelled && Array.isArray(data?.plans) && data.plans.length) setCatalog(data);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    // Signed-in users upgrade from Billing; visitors start by creating an account.
    const startUrl = user ? '/dashboard/billing' : '/register';
    const supportEmail = catalog?.supportEmail || BILLING_EMAIL;
    const discount = catalog?.annualDiscountPercent || 0;

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
                    Start on the free plan. Upgrade for AI tools, more exports and more connected accounts.
                    {discount > 0 && ` Pay yearly and save ${discount}%.`}
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '24px', textAlign: 'left' }}>
                    {catalog.plans.map((plan) => (
                        <div
                            key={plan.id}
                            className="card glass animate-fade-in"
                            style={{
                                padding: '32px',
                                borderTop: `4px solid ${plan.popular ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                                position: 'relative',
                            }}
                        >
                            {plan.popular && (
                                <div style={{ position: 'absolute', top: '-14px', left: '50%', transform: 'translateX(-50%)', background: 'var(--accent-primary)', color: 'var(--accent-contrast)', padding: '4px 16px', borderRadius: '100px', fontSize: '12px', fontWeight: '700', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                                    MOST POPULAR
                                </div>
                            )}
                            <h2 style={{ fontSize: '1.4rem', marginBottom: '16px' }}>{plan.name}</h2>
                            <div style={{ fontSize: plan.contactOnly ? '2rem' : '2.6rem', fontWeight: '800', marginBottom: '8px', lineHeight: 1.2 }}>
                                {plan.monthlyPriceZar === 0 ? 'Free' : `${plan.contactOnly ? 'From ' : ''}${formatZar(plan.monthlyPriceZar)}`}
                                {plan.monthlyPriceZar > 0 && (
                                    <span style={{ fontSize: '1rem', color: 'var(--text-secondary)', fontWeight: '400' }}>/mo</span>
                                )}
                            </div>
                            <p style={{ color: 'var(--text-secondary)', marginBottom: '32px', fontSize: '14px', minHeight: '40px' }}>{plan.description}</p>

                            {plan.contactOnly ? (
                                <a
                                    href={`mailto:${supportEmail}?subject=${encodeURIComponent(`${plan.name} plan enquiry`)}`}
                                    className="btn btn-secondary"
                                    style={linkStyle}
                                >
                                    Contact us
                                </a>
                            ) : (
                                <Link to={startUrl} className={`btn ${plan.popular ? 'btn-primary' : 'btn-secondary'}`} style={linkStyle}>
                                    {plan.purchasable ? 'Get started' : 'Start free'}
                                </Link>
                            )}

                            <ul style={listStyle}>
                                {plan.features.map((f) => (
                                    <li key={f} style={itemStyle}>
                                        <Check size={18} className="text-brand" /> {f}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '48px' }}>
                    Questions about billing? Email <a href={`mailto:${supportEmail}`} style={{ color: 'var(--accent-text)' }}>{supportEmail}</a>.
                </p>
            </main>
            <PublicFooter />
        </div>
    );
}

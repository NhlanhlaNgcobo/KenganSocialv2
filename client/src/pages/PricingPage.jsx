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
import './Pricing.css';

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
        <div className="landing-page bg-primary" style={{ minHeight: '100vh', paddingBottom: '64px' }}>
            <div className="bg-grid absolute-inset" />
            <div className="bg-glow absolute-inset" />

            <LandingNavbar />

            <main className="pricing animate-slide-in">
                <header className="pricing__head">
                    <h1>Pricing</h1>
                    <p>
                        Monthly prices in rand. Start free, then upgrade for AI tools, more exports and more accounts.
                        {discount > 0 && ` Pay yearly and save ${discount}%.`}
                    </p>
                </header>

                <div className="pricing__grid">
                    {catalog.plans.map((plan) => (
                        <div key={plan.id} className={`card glass animate-fade-in pricing__plan ${plan.popular ? 'is-popular' : ''}`}>
                            {plan.popular && <div className="pricing__ribbon">MOST POPULAR</div>}
                            <h2>{plan.name}</h2>
                            <div className={`pricing__price ${plan.contactOnly ? 'is-contact' : ''}`}>
                                {plan.monthlyPriceZar === 0 ? 'Free' : `${plan.contactOnly ? 'From ' : ''}${formatZar(plan.monthlyPriceZar)}`}
                                {plan.monthlyPriceZar > 0 && <span>/mo</span>}
                            </div>
                            <p className="pricing__desc">{plan.description}</p>

                            {plan.contactOnly ? (
                                <a href={`mailto:${supportEmail}?subject=${encodeURIComponent(`${plan.name} plan enquiry`)}`} className="btn btn-secondary pricing__cta">
                                    Contact us
                                </a>
                            ) : (
                                <Link to={startUrl} className={`btn ${plan.popular ? 'btn-primary' : 'btn-secondary'} pricing__cta`}>
                                    {plan.purchasable ? 'Get started' : 'Start free'}
                                </Link>
                            )}

                            <ul className="pricing__features">
                                {plan.features.map((f) => (
                                    <li key={f}>
                                        <Check size={16} className="text-brand" /> {f}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                <p className="pricing__note">
                    Questions about billing? Email <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
                </p>
            </main>
            <PublicFooter />
        </div>
    );
}

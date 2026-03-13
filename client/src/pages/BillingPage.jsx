import { useState, useEffect } from 'react';
import {
    CreditCard,
    Check,
    ShieldCheck,
    Loader2
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { apiClient } from '../lib/api';
import './Billing.css';

const PLANS_DISPLAY = [
    {
        id: 'creator_starter',
        name: 'Creator Starter',
        price: 'R249',
        period: '/ month',
        description: 'Perfect for creators just starting out.',
        features: [
            '1 account per platform (max 4)',
            '1,000 AI credits/month',
            '3 automation rules',
            'Basic analytics',
            'Standard processing speed'
        ],
    },
    {
        id: 'creator_pro',
        name: 'Creator Pro',
        price: 'R499',
        period: '/ month',
        description: 'Scale your presence across all platforms.',
        features: [
            'Up to 3 accounts per platform (max 12)',
            '5,000 AI credits/month',
            'Unlimited automation rules',
            'Priority processing',
            'Advanced analytics'
        ],
        badge: 'Popular',
    },
    {
        id: 'agency',
        name: 'Agency Plan',
        price: 'R3199',
        period: '/ month',
        description: 'For teams managing multiple clients at scale.',
        features: [
            'Up to 10 accounts per platform (max 40)',
            '20,000 AI credits/month',
            'Team access (3 seats)',
            'CRM export',
            'Client reporting dashboard',
            'Faster compute queue'
        ],
    },
    {
        id: 'enterprise',
        name: 'Enterprise',
        price: 'Custom',
        period: '',
        description: 'For large organizations and enterprises.',
        features: [
            '30+ accounts per platform',
            '50,000+ AI credits',
            'White label',
            'Dedicated compute',
            'SLA support',
            '5+ team members',
            'Custom integrations'
        ],
    },
];

export default function BillingPage() {
    const { currentWorkspace } = useWorkspace();
    const [billingInfo, setBillingInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [upgrading, setUpgrading] = useState(null);

    useEffect(() => {
        if (currentWorkspace?.id) {
            loadBilling();
        }
    }, [currentWorkspace]);

    const loadBilling = async () => {
        try {
            setLoading(true);
            const data = await apiClient(`/billing/${currentWorkspace.id}`);
            setBillingInfo(data);
        } catch (error) {
            console.error('Billing load error:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleUpgrade = async (planId) => {
        if (!currentWorkspace?.id) return;
        setUpgrading(planId);

        try {
            const data = await apiClient('/billing/checkout', {
                method: 'POST',
                body: JSON.stringify({
                    workspaceId: currentWorkspace.id,
                    planId,
                }),
            });

            if (data.url) {
                window.location.href = data.url;
            }
        } catch (error) {
            console.error('Checkout error:', error);
            // If Stripe isn't configured, show a friendly message
            alert(error.message || 'Stripe is not configured yet. Set STRIPE_SECRET_KEY in your .env');
        } finally {
            setUpgrading(null);
        }
    };

    const currentPlan = billingInfo?.plan || 'free';
    const currentCredits = billingInfo?.credits ?? 0;

    // Calculate usage percentages
    const maxCredits = billingInfo?.planDetails?.credits || 50;
    const creditPercent = Math.min((currentCredits / maxCredits) * 100, 100);

    return (
        <div className="billing-page animate-fade-in">
            <div className="page-header">
                <div>
                    <h1>Plans & Billing</h1>
                    <p className="page-subtitle">Manage your subscription and usage limits.</p>
                </div>
            </div>

            <div className="usage-overview grid-3">
                <div className="card glass usage-card">
                    <div className="usage-header">
                        <span className="label">AI Credits</span>
                        <span className="val">{loading ? '...' : `${currentCredits} / ${maxCredits}`}</span>
                    </div>
                    <div className="usage-progress">
                        <div className="progress-bar" style={{ width: `${creditPercent}%` }} />
                    </div>
                    <span className="usage-hint">Resets monthly</span>
                </div>
                <div className="card glass usage-card">
                    <div className="usage-header">
                        <span className="label">Current Plan</span>
                        <span className="val" style={{ textTransform: 'capitalize' }}>{loading ? '...' : currentPlan}</span>
                    </div>
                </div>
                <div className="card glass usage-card">
                    <div className="usage-header">
                        <span className="label">Billing Status</span>
                        <span className="val">{billingInfo?.stripeSubscriptionId ? 'Active' : 'No Subscription'}</span>
                    </div>
                </div>
            </div>

            <div className="plans-grid">
                {PLANS_DISPLAY.map(plan => {
                    const isCurrent = currentPlan === plan.id;
                    return (
                        <div key={plan.id} className={`plan-card card ${isCurrent ? 'plan-card--active' : ''}`}>
                            {plan.badge && <span className="plan-badge">{plan.badge}</span>}
                            <div className="plan-header">
                                <h3>{plan.name}</h3>
                                <div className="plan-price">
                                    <span className="price">{plan.price}</span>
                                    <span className="period">{plan.period}</span>
                                </div>
                                <p className="plan-desc">{plan.description}</p>
                            </div>
                            <div className="plan-features">
                                {plan.features.map(f => (
                                    <div key={f} className="feature-item">
                                        <Check size={16} className="text-success" />
                                        <span>{f}</span>
                                    </div>
                                ))}
                            </div>
                            {plan.id === 'enterprise' ? (
                                <a href="mailto:contact@kengansocial.com" className="btn full-width btn-primary flex justify-center items-center">
                                    Contact Us
                                </a>
                            ) : (
                                <button
                                    className={`btn full-width ${isCurrent ? 'btn-secondary' : 'btn-primary'}`}
                                    onClick={() => !isCurrent && handleUpgrade(plan.id)}
                                    disabled={isCurrent || upgrading === plan.id}
                                >
                                    {upgrading === plan.id ? (
                                        <><Loader2 size={16} className="spin" /> Processing...</>
                                    ) : isCurrent ? 'Current Plan' : 'Upgrade Plan'}
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            <section className="payment-methods card">
                <div className="flex justify-between items-center mb-lg">
                    <div className="section-title mb-0">
                        <CreditCard size={20} className="text-brand" />
                        <h3 className="mb-0">Payment Method</h3>
                    </div>
                </div>
                <div className="card glass flex items-center gap-md p-lg">
                    <div className="card-brand-icon">
                        <ShieldCheck size={24} className="text-success" />
                    </div>
                    <div className="card-details">
                        {billingInfo?.stripeCustomerId ? (
                            <>
                                <span className="card-number">Stripe Connected</span>
                                <span className="card-expiry">Customer ID: {billingInfo.stripeCustomerId.substring(0, 10)}...</span>
                            </>
                        ) : (
                            <>
                                <span className="card-number">No payment method</span>
                                <span className="card-expiry">Upgrade to add a payment method</span>
                            </>
                        )}
                    </div>
                </div>
            </section>
        </div>
    );
}

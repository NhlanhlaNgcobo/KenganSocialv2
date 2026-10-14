import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { CreditCard, CheckCircle2, AlertCircle, TrendingUp, Zap, Clock, MessageSquare, MonitorPlay } from 'lucide-react';
import './BillingPage.css';

// Using exact API thresholds
const PLAN_LIMITS: any = {
    starter: { posts: 10, aiCalls: 50, exports: 5, transcribeHrs: 0 },
    nano: { posts: 50, aiCalls: 500, exports: 30, transcribeHrs: 2 },
    creator: { posts: 200, aiCalls: 2000, exports: 100, transcribeHrs: 10 },
    agency: { posts: 9999, aiCalls: 10000, exports: 9999, transcribeHrs: 50 }
};

const PLAN_NAMES = { starter: 'Starter', nano: 'Nano Creator', creator: 'Creator Pro', agency: 'Agency' };

export default function BillingPage() {
    const { user, plan } = useAuth();
    const API_ROOT = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/api$/, '');
    const [loading, setLoading] = useState(true);
    const [upgrading, setUpgrading] = useState(false);

    const [status, setStatus] = useState<any>({
        plan: 'starter', subscriptionId: null, currentPeriodEnd: null, paymentStatus: 'active',
        usage: { posts: 0, aiCalls: 0, exports: 0, transcribeHrs: 0 }
    });

    const [showModal, setShowModal] = useState(false);
    const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

    useEffect(() => {
        fetchBillingStatus();
    }, [user]);

    const fetchBillingStatus = async () => {
        setLoading(true);
        try {
            const token = await user?.getIdToken();
            const res = await fetch(`${API_ROOT}/api/billing/status`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success) {
                setStatus({ ...data, plan: data.plan || 'starter' });
            }
        } catch (err) {
            console.error(err);
        }
        setLoading(false);
    };

    const handleUpgrade = async (planName: string) => {
        setUpgrading(true);
        try {
            const token = await user?.getIdToken();
            const res = await fetch(`${API_ROOT}/api/billing/create-checkout`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ planName, interval: billingCycle })
            });
            const data = await res.json();
            if (data.success && data.url) {
                window.location.href = data.url;
            }
        } catch (err) {
            alert('Upgrade failed. Please try again.');
        }
        setUpgrading(false);
    };

    const handlePortal = async () => {
        try {
            const token = await user?.getIdToken();
            const res = await fetch(`${API_ROOT}/api/billing/portal`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success && data.url) window.location.href = data.url;
        } catch (err) { }
    };

    const UsageBar = ({ label, icon: Icon, used, limit }: any) => {
        const p = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
        let color = '#8b5cf6'; // normal
        if (p >= 80) color = '#f59e0b'; // amber
        if (p >= 95) color = '#ef4444'; // red

        return (
            <div className="usage-item">
                <div className="usage-row">
                    <div className="usage-label"><Icon size={16} /> {label}</div>
                    <div className="usage-val">{used.toLocaleString()} / {limit > 5000 ? 'Unlimited' : limit.toLocaleString()}</div>
                </div>
                <div className="bar-bg">
                    <div className="bar-fill" style={{ width: `${p}%`, background: color }} />
                </div>
            </div>
        );
    };

    const currentLimits = PLAN_LIMITS[status.plan] || PLAN_LIMITS.starter;

    if (loading) return <div className="loading-state">Loading billing layout...</div>;

    return (
        <div className="billing-container">
            <div className="billing-header">
                <h1>Billing & Usage</h1>
                <p className="subtitle">Manage your subscription, track usage blocks mapped dynamically to your tier.</p>
            </div>

            <div className="billing-content">

                {/* CURRENT PLAN CARD */}
                <div className="billing-card current-plan-card">
                    <div className="plan-overview">
                        <div>
                            <span className="plan-label">Current Plan</span>
                            <h2>{PLAN_NAMES[status.plan as keyof typeof PLAN_NAMES] || 'Starter'}</h2>

                            {status.paymentStatus === 'failed' && (
                                <span className="badge-danger"><AlertCircle size={14} /> Payment Failed - Update Method</span>
                            )}
                            {status.paymentStatus === 'active' && status.plan !== 'starter' && (
                                <span className="badge-success"><CheckCircle2 size={14} /> Active Subscription</span>
                            )}
                            {status.plan === 'starter' && (
                                <span className="badge-warning">Free Tier Limits Apply</span>
                            )}
                        </div>

                        {status.subscriptionId ? (
                            <button className="btn-outline" onClick={handlePortal}><CreditCard size={16} /> Manage Billing via Paystack</button>
                        ) : (
                            <button className="btn-primary" onClick={() => setShowModal(true)}><TrendingUp size={16} /> Upgrade Plan</button>
                        )}
                    </div>

                    {status.currentPeriodEnd && (
                        <div className="renewal-info">
                            <Clock size={16} /> Subscription renews on: {new Date(status.currentPeriodEnd).toLocaleDateString()}
                        </div>
                    )}
                </div>

                {/* USAGE METRICS */}
                <div className="billing-card usage-card">
                    <div className="card-header">
                        <h3>Cycle Usage</h3>
                        <p>Resets at the start of your next billing period.</p>
                    </div>

                    <div className="usage-bars-grid">
                        <UsageBar label="Scheduled Posts" icon={MonitorPlay} used={status.usage.posts} limit={currentLimits.posts} />
                        <UsageBar label="AI Smart Calls (GPT/Generation)" icon={Zap} used={status.usage.aiCalls} limit={currentLimits.aiCalls} />
                        <UsageBar label="Video Exports (Remotion)" icon={MonitorPlay} used={status.usage.exports} limit={currentLimits.exports} />
                        <UsageBar label="Transcription (Hours)" icon={MessageSquare} used={status.usage.transcribeHrs} limit={currentLimits.transcribeHrs} />
                    </div>

                    <div className="usage-warning">
                        {Object.keys(currentLimits).some(k => currentLimits[k] > 0 && status.usage[k] / currentLimits[k] >= 0.8) && (
                            <div className="alert-amber">
                                <AlertCircle size={18} /> You are approaching your cycle limits. Upgrades are pro-rated instantly.
                                <button className="btn-ghost" onClick={() => setShowModal(true)}>Upgrade Now</button>
                            </div>
                        )}
                    </div>
                </div>

            </div>

            {/* UPGRADE MODAL */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal-content pricing-modal" onClick={e => e.stopPropagation()}>
                        <button className="close-btn" onClick={() => setShowModal(false)}>×</button>
                        <h2>Select your Growth Tier</h2>

                        <div className="billing-toggle">
                            <button className={billingCycle === 'monthly' ? 'active' : ''} onClick={() => setBillingCycle('monthly')}>Monthly</button>
                            <button className={billingCycle === 'yearly' ? 'active' : ''} onClick={() => setBillingCycle('yearly')}>
                                Yearly <span className="discount-badge">-20%</span>
                            </button>
                        </div>

                        <div className="pricing-grid">

                            <div className="pricing-tier">
                                <h3>Nano Creator</h3>
                                <div className="price">R {billingCycle === 'monthly' ? '149' : '1,430'}<small>/{billingCycle === 'monthly' ? 'mo' : 'yr'} ZAR</small></div>
                                <ul className="features">
                                    <li>50 Scheduled Posts</li>
                                    <li>500 AI Generations</li>
                                    <li>10GB Cloud Storage</li>
                                    <li>Remotion Integrations</li>
                                </ul>
                                <button className="btn-outline full-width" onClick={() => handleUpgrade('nano')} disabled={upgrading}>
                                    {upgrading ? 'Connecting...' : 'Select Nano'}
                                </button>
                            </div>

                            <div className="pricing-tier popular">
                                <div className="popular-badge">Most Popular</div>
                                <h3>Creator Pro</h3>
                                <div className="price">R {billingCycle === 'monthly' ? '349' : '3,350'}<small>/{billingCycle === 'monthly' ? 'mo' : 'yr'} ZAR</small></div>
                                <ul className="features">
                                    <li>200 Scheduled Posts</li>
                                    <li>2000 AI Generations</li>
                                    <li>50GB Cloud Storage</li>
                                    <li>Viral Clip Analysis</li>
                                    <li>Smart DM Queues</li>
                                </ul>
                                <button className="btn-primary full-width" onClick={() => handleUpgrade('creator')} disabled={upgrading}>
                                    {upgrading ? 'Connecting...' : 'Select Creator'}
                                </button>
                            </div>

                            <div className="pricing-tier">
                                <h3>Agency</h3>
                                <div className="price">R {billingCycle === 'monthly' ? '2,499' : '23,990'}<small>/{billingCycle === 'monthly' ? 'mo' : 'yr'} ZAR</small></div>
                                <ul className="features">
                                    <li>Unlimited Workspaces</li>
                                    <li>Lead Scoring CRM</li>
                                    <li>Automated DM Rules</li>
                                    <li>500GB Analytics Retentions</li>
                                </ul>
                                <button className="btn-outline full-width" onClick={() => handleUpgrade('agency')} disabled={upgrading}>
                                    {upgrading ? 'Connecting...' : 'Select Agency'}
                                </button>
                            </div>

                        </div>
                        <p style={{ textAlign: 'center', fontSize: '0.8rem', color: '#888', marginTop: '24px' }}>All prices exclusive of 15% SA VAT. Billed natively via Paystack.</p>
                    </div>
                </div>
            )}
        </div>
    );
}

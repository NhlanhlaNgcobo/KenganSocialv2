import React, { useState, useEffect } from 'react';
import {
    CreditCard,
    Zap,
    ArrowUpCircle,
    CheckCircle2,
    AlertCircle,
    Check,
    ChevronRight,
    Clock,
    TrendingUp,
    ChevronDown,
    Crown,
    Star,
    Rocket,
    Shield
} from 'lucide-react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { apiClient } from '../../lib/api';
import './BillingPage.css';

const FRONTEND_LIMITS: any = {
    starter: { posts: 10, exports: 3, connections: 2, aiCalls: 0, renders: 0 },
    nano: { posts: 30, exports: 10, connections: 3, aiCalls: 200, renders: 10 },
    creator: { posts: 100, exports: 30, connections: 5, aiCalls: 1000, renders: 50 },
    agency: { posts: 99999, exports: 99999, connections: 99999, aiCalls: 99999, renders: 500 }
};

interface BillingStatus {
    plan: string;
    subscriptionId: string;
    currentPeriodEnd: string;
    paymentStatus: 'active' | 'failed' | 'past_due' | 'cancelled';
    usage: {
        posts: number;
        exports: number;
        aiCalls: number;
        transcribeHrs: number;
        clipAnalysis: number;
        dmsDay: number;
        renders: number;
    };
}

export default function BillingPage() {
    const { currentWorkspace } = useWorkspace() as any;
    const [status, setStatus] = useState<BillingStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
    const [interval, setIntervalType] = useState<'monthly' | 'yearly'>('monthly');

    useEffect(() => {
        if (currentWorkspace?.id) {
            fetchStatus();
        }
    }, [currentWorkspace?.id]);

    const fetchStatus = async () => {
        try {
            setLoading(true);
            const res = await apiClient('/api/billing/status');
            setStatus(res);
        } catch (err) {
            console.error('Failed to fetch billing status:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleCheckout = async (planName: string) => {
        try {
            const res = await apiClient('/api/billing/create-checkout', {
                method: 'POST',
                body: { planName, interval }
            });
            if (res.url) window.location.href = res.url;
        } catch (err) {
            console.error('Checkout failed:', err);
        }
    };

    const handlePortal = async () => {
        try {
            const res = await apiClient('/api/billing/portal', { method: 'POST' });
            if (res.url) window.location.href = res.url;
        } catch (err) {
            console.error('Portal failed:', err);
        }
    };

    if (loading && !status) return <div className="p-20 text-center">Checking Subscription Status...</div>;

    const currentPlan = status?.plan || 'starter';
    const limits = FRONTEND_LIMITS[currentPlan] || FRONTEND_LIMITS.starter;

    return (
        <div className="billing-page">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-2xl font-extrabold tracking-tight">Plan & Billing</h1>
                    <p className="text-gray-500">Manage your subscription and track resource consumption</p>
                </div>
                <div className="flex gap-4">
                    <button className="btn btn-secondary flex items-center gap-2" onClick={handlePortal}>
                        <CreditCard size={18} /> Manage Payment
                    </button>
                    <button className="btn btn-primary flex items-center gap-2" onClick={() => setIsUpgradeModalOpen(true)}>
                        <ArrowUpCircle size={18} /> Upgrade Plan
                    </button>
                </div>
            </div>

            {/* ── CURRENT PLAN CARD ── */}
            <div className="billing-card">
                <div className="current-plan-header">
                    <div className="plan-info">
                        <h2>{currentPlan} Creator</h2>
                        <div className="flex items-center gap-4 text-sm text-gray-500">
                            <span className="flex items-center gap-1"><Clock size={14} /> Renews on {new Date(status?.currentPeriodEnd || '').toLocaleDateString()}</span>
                            <span>•</span>
                            <span>ID: {status?.subscriptionId ? `****${status.subscriptionId.slice(-4)}` : 'Manual Activation'}</span>
                        </div>
                    </div>
                    <div className="plan-status">
                        <CheckCircle2 size={16} /> {status?.paymentStatus === 'active' ? 'Active Subscription' : (status?.paymentStatus || 'Active Plan')}
                    </div>
                </div>

                <div className="usage-section">
                    <h3>Monthly Resource Consumption</h3>
                    <div className="usage-grid">
                        <UsageBar label="Posts Scheduled" current={status?.usage.posts || 0} limit={limits.posts} />
                        <UsageBar label="Video Exports" current={status?.usage.exports || 0} limit={limits.exports} />
                        <UsageBar label="AI Generation" current={status?.usage.aiCalls || 0} limit={limits.aiCalls} unit="requests" />
                        <UsageBar label="Creative Renders" current={status?.usage.renders || 0} limit={limits.renders} />
                    </div>
                </div>

                {status?.paymentStatus === 'failed' && (
                    <div className="overage-alert">
                        <AlertCircle size={20} />
                        <div>
                            <p className="font-bold">Payment Failure Detected</p>
                            <p className="text-xs">Your last invoice could not be processed. Please update your payment method to avoid service interruption.</p>
                        </div>
                        <button className="ml-auto btn btn-sm btn-ghost" onClick={handlePortal}>Update Cards</button>
                    </div>
                )}
            </div>

            {/* ── UPGRADE MODAL ── */}
            {isUpgradeModalOpen && (
                <div className="modal-overlay">
                    <div className="pricing-modal modal-content p-8">
                        <div className="flex justify-between items-center">
                            <h2 className="text-2xl font-extrabold">Choose Your Power Level</h2>
                            <button onClick={() => setIsUpgradeModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full">✕</button>
                        </div>

                        <div className="flex justify-center mt-6">
                            <div className="period-toggle">
                                <button className={interval === 'monthly' ? 'active' : ''} onClick={() => setIntervalType('monthly')}>Monthly</button>
                                <button className={interval === 'yearly' ? 'active' : ''} onClick={() => setIntervalType('yearly')}>Yearly (save 20%)</button>
                            </div>
                        </div>

                        <div className="plans-row">
                            <PlanPicker
                                name="Starter"
                                price="R0"
                                feature="Personal Branding"
                                list={['10 Posts', '3 Video Exports', '0 AI Credits', 'Basic Analytics']}
                                icon={Rocket}
                                isCurrent={currentPlan === 'starter'}
                                onSelect={() => { }}
                            />
                            <PlanPicker
                                name="Nano"
                                price={interval === 'monthly' ? 'R149' : 'R1,430'}
                                feature="Rising Star"
                                list={['30 Posts', '10 Video Exports', '200 AI Credits', 'Advanced Analytics', 'Trend Alerts']}
                                icon={Star}
                                isCurrent={currentPlan === 'nano'}
                                onSelect={() => handleCheckout('nano')}
                            />
                            <PlanPicker
                                name="Creator"
                                price={interval === 'monthly' ? 'R349' : 'R3,350'}
                                feature="Professional"
                                list={['100 Posts', '30 Video Exports', '1,000 AI Credits', 'Viral Analysis', 'Automation Suite']}
                                icon={Crown}
                                popular
                                isCurrent={currentPlan === 'creator'}
                                onSelect={() => handleCheckout('creator')}
                            />
                            <PlanPicker
                                name="Agency"
                                price={interval === 'monthly' ? 'R2,499' : 'R23,990'}
                                feature="Dominance"
                                list={['Unlimited Posts', 'Unlimited Exports', 'Unlimited AI', 'Lead Generation', '2yr Data Retention']}
                                icon={Shield}
                                isCurrent={currentPlan === 'agency'}
                                onSelect={() => handleCheckout('agency')}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function UsageBar({ label, current, limit, unit = '' }: any) {
    const percentage = Math.min(100, (current / (limit || 1)) * 100);
    const statusClass = percentage > 95 ? 'danger' : percentage > 80 ? 'warning' : 'normal';

    return (
        <div className="usage-item">
            <div className="usage-label">
                <span>{label}</span>
                <span>{current} / {limit === 99999 ? '∞' : limit} {unit}</span>
            </div>
            <div className="progress-bar-bg">
                <div
                    className={`progress-fill ${statusClass}`}
                    style={{ width: `${percentage}%` }}
                />
            </div>
            {percentage > 90 && limit !== 99999 && (
                <span className="text-[10px] font-bold text-red-500 uppercase flex items-center gap-1">
                    <AlertCircle size={10} /> Approaching Limit
                </span>
            )}
        </div>
    );
}

function PlanPicker({ name, price, feature, list, icon: Icon, popular, isCurrent, onSelect }: any) {
    return (
        <div className={`plan-picker-card ${popular ? 'popular' : ''} ${isCurrent ? 'bg-gray-50 border-gray-400 opacity-80' : ''}`}>
            <div className="flex items-center gap-3">
                <div className="p-2 bg-gray-100 rounded-lg text-accent">
                    <Icon size={18} />
                </div>
                <div>
                    <h4>{name}</h4>
                    <span className="text-[10px] uppercase font-bold text-accent">{feature}</span>
                </div>
            </div>
            <div className="price-box">
                <span className="price-main">{price}</span>
                <span className="price-sub"> / {price === 'R0' ? 'forever' : 'billing period'}</span>
            </div>
            <div className="plan-features">
                {list.map((item: string) => (
                    <div key={item} className="feature-check">
                        <Check size={14} className="text-green-500" />
                        <span>{item}</span>
                    </div>
                ))}
            </div>
            <button
                className={`btn ${popular ? 'btn-primary' : 'btn-secondary'} w-full mt-4`}
                onClick={onSelect}
                disabled={isCurrent}
            >
                {isCurrent ? 'Active Plan' : (name === 'Starter' ? 'Current Free' : 'Choose Plan')}
            </button>
        </div>
    );
}

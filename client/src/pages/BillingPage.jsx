import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Loader2, Mail, RefreshCw } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { apiClient } from '../lib/api';
import { BILLING_EMAIL, PLAN_RANK, fetchPlanCatalog, formatZar } from '../utils/planLimits';
import './Billing.css';

const USAGE_ROWS = [
    { key: 'posts', label: 'Scheduled posts' },
    { key: 'exports', label: 'Video exports' },
    { key: 'aiCalls', label: 'AI credits' },
    { key: 'renders', label: 'AI renders' },
];

function formatDate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
}

function mailto(email, subject) {
    return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
}

function UsageMeter({ label, used, limit }) {
    let value;
    let percent = 0;
    if (limit === 0) value = 'Not included';
    else if (limit === -1) value = `${used.toLocaleString('en-ZA')} used · Unlimited`;
    else {
        value = `${used.toLocaleString('en-ZA')} / ${limit.toLocaleString('en-ZA')}`;
        percent = Math.min((used / limit) * 100, 100);
    }
    return (
        <div className="billing-usage-row">
            <div className="usage-header">
                <span className="label">{label}</span>
                <span className="val">{value}</span>
            </div>
            {limit > 0 && (
                <div className="usage-progress">
                    <div className="progress-bar" style={{ width: `${percent}%` }} />
                </div>
            )}
        </div>
    );
}

export default function BillingPage() {
    const { currentWorkspace, loading: workspaceLoading } = useWorkspace();
    const [searchParams, setSearchParams] = useSearchParams();
    const [catalog, setCatalog] = useState(null);
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [billingInterval, setBillingInterval] = useState('monthly');
    const [upgrading, setUpgrading] = useState(null);
    const [checkoutError, setCheckoutError] = useState('');
    const [verifyState, setVerifyState] = useState(null); // { kind: 'pending'|'success'|'error'|'info', message }
    const verifiedRef = useRef(null);

    const workspaceId = currentWorkspace?.id;

    const loadBilling = useCallback(async () => {
        setLoading(true);
        setLoadError('');
        const [catalogResult, statusResult] = await Promise.allSettled([
            fetchPlanCatalog(),
            apiClient('/billing/status'),
        ]);
        if (catalogResult.status === 'fulfilled') setCatalog(catalogResult.value);
        if (statusResult.status === 'fulfilled') setStatus(statusResult.value);
        const failure = [catalogResult, statusResult].find((r) => r.status === 'rejected');
        if (failure) setLoadError(failure.reason?.message || 'Could not load billing details.');
        setLoading(false);
    }, []);

    useEffect(() => {
        if (workspaceId) loadBilling();
    }, [workspaceId, loadBilling]);

    // Returning from the payment provider: /dashboard/billing?reference=...&trxref=...
    const manageSubscription = async () => {
        setCheckoutError('');
        try {
            const result = await apiClient('/billing/portal', { method: 'POST' });
            window.location.assign(result.url);
        } catch (error) { setCheckoutError(error.message || 'Could not open subscription management.'); }
    };

    const cancelSubscription = async () => {
        if (!window.confirm('Cancel automatic renewal? You keep access until the end of your paid period.')) return;
        setCheckoutError('');
        try {
            const result = await apiClient('/billing/cancel-subscription', { method: 'POST' });
            setVerifyState({ kind: 'success', message: result.message });
            await loadBilling();
        } catch (error) { setCheckoutError(error.message); }
    };

    const reference = searchParams.get('reference') || searchParams.get('trxref');
    useEffect(() => {
        if (!reference || !workspaceId || verifiedRef.current === reference) return;
        verifiedRef.current = reference;
        (async () => {
            setVerifyState({ kind: 'pending', message: 'Confirming your payment…' });
            try {
                const result = await apiClient(`/billing/verify/${encodeURIComponent(reference)}`);
                if (result.success) {
                    const until = formatDate(result.currentPeriodEnd);
                    setVerifyState({
                        kind: 'success',
                        message: `Payment received. You're on ${result.planName || 'your new plan'}${until ? ` until ${until}` : ''}.`,
                    });
                } else {
                    setVerifyState({ kind: result.status === 'pending' ? 'info' : 'error', message: result.message });
                }
            } catch (error) {
                setVerifyState({ kind: 'error', message: error.message || 'Could not confirm your payment.' });
            } finally {
                setSearchParams({}, { replace: true });
                loadBilling();
            }
        })();
    }, [reference, workspaceId, loadBilling, setSearchParams]);

    const handleCheckout = async (planId) => {
        setUpgrading(planId);
        setCheckoutError('');
        try {
            const data = await apiClient('/billing/create-checkout', {
                method: 'POST',
                body: { planName: planId, interval: billingInterval },
            });
            if (!data.url) throw new Error('Checkout could not be started. Try again.');
            if (data.method === 'POST' && data.provider === 'payfast') {
                const url = new URL(data.url);
                if (!['www.payfast.co.za', 'sandbox.payfast.co.za'].includes(url.hostname) || url.protocol !== 'https:') throw new Error('Invalid payment destination.');
                const form = document.createElement('form');
                form.method = 'POST'; form.action = url.href;
                for (const [name, value] of Object.entries(data.fields || {})) {
                    const field = document.createElement('input');
                    field.type = 'hidden'; field.name = name; field.value = String(value);
                    form.appendChild(field);
                }
                document.body.appendChild(form); form.submit();
            } else window.location.assign(data.url);
        } catch (error) {
            setCheckoutError(error.message || 'Checkout could not be started. Try again.');
            setUpgrading(null);
        }
    };

    if (!workspaceId) {
        return (
            <div className="billing-page animate-fade-in">
                <div className="page-header">
                    <div>
                        <h1>Plans & Billing</h1>
                    </div>
                </div>
                <div className="card billing-empty">
                    {workspaceLoading ? (
                        <><Loader2 size={18} className="spin" /> Loading your workspace…</>
                    ) : (
                        'Create or select a workspace to see its plan.'
                    )}
                </div>
            </div>
        );
    }

    const supportEmail = catalog?.supportEmail || status?.supportEmail || BILLING_EMAIL;
    // On the full-access trial nothing is paid for yet: every paid plan can be bought.
    const onTrial = status?.paymentStatus === 'trial';
    const trialEnds = formatDate(status?.trialEndsAt);
    const currentTier = status ? (onTrial ? 'starter' : status.plan) : null;
    const currentPlanId = status ? (onTrial ? 'starter' : status.planId) : null;
    const currentRank = currentTier ? PLAN_RANK[currentTier] ?? 0 : null;
    const discount = catalog?.annualDiscountPercent || 0;
    const paidUntil = formatDate(status?.currentPeriodEnd);
    const isPaid = currentTier && currentTier !== 'starter';

    const renderAction = (plan) => {
        const isCurrent = currentPlanId === plan.id;
        if (isCurrent) {
            return <button className="btn btn-secondary full-width" disabled>Current plan</button>;
        }
        if (plan.contactOnly) {
            return (
                <a className="btn btn-secondary full-width" href={mailto(supportEmail, `${plan.name} plan enquiry`)}>
                    <Mail size={16} /> Contact us
                </a>
            );
        }
        const rank = PLAN_RANK[plan.tier] ?? 0;
        const isDowngrade = currentRank !== null && rank < currentRank;
        if (isDowngrade || !plan.purchasable) {
            // Downgrades are handled by billing support so no one loses paid time by accident.
            return (
                <a className="btn btn-ghost full-width" href={mailto(supportEmail, `Change my plan to ${plan.name}`)}>
                    Downgrade
                </a>
            );
        }
        const busy = upgrading === plan.id;
        return (
            <button
                className="btn btn-primary full-width"
                onClick={() => handleCheckout(plan.id)}
                disabled={Boolean(upgrading) || !status || !['owner', 'admin'].includes(currentWorkspace?.role)}
            >
                {busy ? <><Loader2 size={16} className="spin" /> Opening checkout…</> : rank === currentRank ? 'Switch' : 'Upgrade'}
            </button>
        );
    };

    return (
        <div className="billing-page animate-fade-in">
            <div className="page-header">
                <div>
                    <h1>Plans & Billing</h1>
                    <p className="page-subtitle">Subscriptions renew automatically each month or year through Paystack. Manage or cancel renewal below. Prices are in rand.</p>
                </div>
            </div>

            {verifyState && (
                <div className={verifyState.kind === 'success' ? 'success-banner' : verifyState.kind === 'error' ? 'error-banner' : 'billing-info-banner'} role="status">
                    {verifyState.kind === 'pending' && <Loader2 size={16} className="spin" />}
                    <span>{verifyState.message}</span>
                </div>
            )}

            {loadError && (
                <div className="error-banner" role="alert">
                    <span>{loadError}</span>
                    <button className="btn btn-ghost btn-sm" onClick={loadBilling} disabled={loading}>
                        <RefreshCw size={14} /> Retry
                    </button>
                </div>
            )}

            {catalog && !catalog.paymentsConfigured && (
                <div className="billing-info-banner" role="status">
                    <span>
                        Payments aren't set up yet, so upgrades can't be paid online. Email{' '}
                        <a href={mailto(supportEmail, 'Upgrade my plan')}>{supportEmail}</a> and we'll upgrade you.
                    </span>
                </div>
            )}

            <div className="usage-overview grid-3">
                <div className="card usage-card">
                    <div className="usage-header">
                        <span className="label">Current plan</span>
                        <span className="val">{loading && !status ? '…' : onTrial ? `${status.planName} trial` : status?.planName || '—'}</span>
                    </div>
                    <span className="usage-hint">
                        {!status
                            ? ' '
                            : onTrial
                                ? `Full access until ${trialEnds}, then the free plan unless you upgrade.`
                                : isPaid
                                ? paidUntil
                                    ? `Paid until ${paidUntil}${status.billingInterval === 'yearly' ? ' (annual)' : ''}`
                                    : `Payment status: ${status.paymentStatus}`
                                : 'Free forever. Upgrade any time.'}
                    </span>
                </div>
                <div className="card usage-card billing-usage-card">
                    {!status ? (
                        <span className="usage-hint">{loading ? 'Loading usage…' : 'Usage unavailable.'}</span>
                    ) : status.usageAvailable && status.usage ? (
                        USAGE_ROWS.map((row) => (
                            <UsageMeter key={row.key} label={row.label} used={status.usage[row.key] || 0} limit={status.limits[row.key]} />
                        ))
                    ) : (
                        <>
                            <div className="usage-header">
                                <span className="label">This month's usage</span>
                            </div>
                            <span className="usage-hint">Usage counters are unavailable right now. Your limits still apply.</span>
                        </>
                    )}
                    {status && <span className="usage-hint">Counters reset on the 1st of each month (UTC).</span>}
                </div>
                <div className="card usage-card">
                    <div className="usage-header">
                        <span className="label">Storage</span>
                        <span className="val">
                            {!status
                                ? '…'
                                : status.storageGB === null
                                    ? `— / ${status.limits.storageGB} GB`
                                    : `${status.storageGB.toFixed(2)} / ${status.limits.storageGB} GB`}
                        </span>
                    </div>
                    {status && status.storageGB !== null && (
                        <div className="usage-progress">
                            <div className="progress-bar" style={{ width: `${Math.min((status.storageGB / status.limits.storageGB) * 100, 100)}%` }} />
                        </div>
                    )}
                </div>
            </div>

            <div className="billing-plans-head">
                <h2>Plans</h2>
                {discount > 0 && (
                    <div className="segmented" role="group" aria-label="Billing interval">
                        <button className={billingInterval === 'monthly' ? 'is-active' : ''} onClick={() => setBillingInterval('monthly')}>Monthly</button>
                        <button className={billingInterval === 'yearly' ? 'is-active' : ''} onClick={() => setBillingInterval('yearly')}>
                            Annual <span className="badge badge-success">-{discount}%</span>
                        </button>
                    </div>
                )}
            </div>

            {checkoutError && (
                <div className="error-banner" role="alert">
                    <span>{checkoutError}</span>
                </div>
            )}

            {!catalog ? (
                <div className="card billing-empty">
                    {loading ? <><Loader2 size={18} className="spin" /> Loading plans…</> : 'Plans could not be loaded.'}
                </div>
            ) : (
                <div className="plans-grid">
                    {catalog.plans.map((plan) => {
                        const isCurrent = currentPlanId === plan.id;
                        const annual = billingInterval === 'yearly' && plan.monthlyPriceZar > 0 && !plan.contactOnly;
                        const price = annual ? plan.annualMonthlyPriceZar : plan.monthlyPriceZar;
                        return (
                            <div key={plan.id} className={`plan-card card ${isCurrent ? 'plan-card--active' : ''}`}>
                                {isCurrent ? (
                                    <span className="plan-badge">Your plan</span>
                                ) : plan.popular ? (
                                    <span className="plan-badge plan-badge--muted">Popular</span>
                                ) : null}
                                <div className="plan-header">
                                    <h3>{plan.name}</h3>
                                    <div className="plan-price">
                                        <span className="price">
                                            {plan.monthlyPriceZar === 0 ? 'Free' : `${plan.contactOnly ? 'From ' : ''}${formatZar(price)}`}
                                        </span>
                                        {plan.monthlyPriceZar > 0 && <span className="period">/ month</span>}
                                    </div>
                                    {annual && (
                                        <p className="plan-billed">Billed {formatZar(price * 12)} yearly</p>
                                    )}
                                    <p className="plan-desc">{plan.description}</p>
                                </div>
                                <div className="plan-features">
                                    {plan.features.map((f) => (
                                        <div key={f} className="feature-item">
                                            <Check size={16} className="text-success" />
                                            <span>{f}</span>
                                        </div>
                                    ))}
                                </div>
                                {renderAction(plan)}
                            </div>
                        );
                    })}
                </div>
            )}

            <section className="payment-methods card">
                <h3>Manage billing</h3>
                {status?.canCancelSubscription && ['owner', 'admin'].includes(currentWorkspace?.role) && <button className="btn btn-secondary" onClick={cancelSubscription}>Cancel renewal</button>}
                <p className="billing-manage-copy">
                    Manage your payment card or cancel automatic renewal below. Access continues until the paid period ends. For plan changes or invoices, email {supportEmail}.
                </p>
                <button className="btn btn-secondary" onClick={manageSubscription} disabled={!['owner', 'admin'].includes(currentWorkspace?.role)}>
                    Manage subscription / cancel
                </button>
            </section>
        </div>
    );
}

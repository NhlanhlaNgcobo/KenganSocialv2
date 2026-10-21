import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import '../../pages/Legal.css';

// ─── KEY SUMMARY POINTS (shown inside the modal) ──────────────────────────────
const SUMMARY_POINTS = [
    {
        heading: 'Who we are',
        body: 'KenganSocial (Pty) Ltd is a South African company providing an AI-powered social media automation platform. Our platform is governed by South African law including POPIA, ECTA, and the Consumer Protection Act.',
    },
    {
        heading: 'What you agree to',
        body: 'You must be 18+. You agree not to use the platform for spam, illegal content, account manipulation, or reselling access. You remain solely responsible for all content you create and publish through KenganSocial.',
    },
    {
        heading: 'Your subscription',
        body: 'Plans are billed monthly in advance in ZAR. A 7-day cooling-off period applies to your first paid subscription. You may cancel anytime — access continues until the end of the billing period. Agency plan fair-use caps apply.',
    },
    {
        heading: 'Your data & privacy',
        body: 'We collect your account info, usage data, and linked social media tokens (encrypted AES-256). We never sell your personal information. You have full POPIA rights including access, correction, deletion, and the right to object to processing. Contact: privacy@kengansocial.com',
    },
    {
        heading: 'Your content',
        body: 'You own your content. We only use it to provide the service. AI-generated captions and clips are provided as suggestions — you are responsible for reviewing them before publishing.',
    },
    {
        heading: 'Disputes & liability',
        body: 'Disputes are resolved under South African law, first through negotiation, then AFSA mediation/arbitration. Our liability is capped at what you paid in the 12 months prior to the claim.',
    },
];

// ─── TERMS ACCEPTANCE MODAL ───────────────────────────────────────────────────

/**
 * TermsModal
 *
 * Props:
 *   onAccept(record)  — called with the consent record object when all required
 *                       checkboxes are checked and the user clicks Accept.
 *   onDecline()       — called when the user confirms they want to decline
 *                       (after seeing the "you must accept" screen).
 */
export default function TermsModal({ onAccept, onDecline }) {
    const navigate = useNavigate();

    const [scrollProgress, setScrollProgress] = useState(0);
    const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
    const [checkedTerms, setCheckedTerms] = useState(false);
    const [checkedPrivacy, setCheckedPrivacy] = useState(false);
    const [checkedAge, setCheckedAge] = useState(false);
    const [checkedMarketing, setCheckedMarketing] = useState(false);
    const [declined, setDeclined] = useState(false);

    const scrollRef = useRef(null);

    const handleScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const pct = el.scrollTop / (el.scrollHeight - el.clientHeight);
        setScrollProgress(Math.min(pct, 1));
        if (pct > 0.92) setHasScrolledToBottom(true);
    }, []);

    const canAccept = checkedTerms && checkedPrivacy && checkedAge;

    // ── Declined screen ──
    if (declined) {
        return (
            <div className="terms-modal-overlay">
                <div className="terms-modal">
                    <div className="terms-modal-header">
                        <div className="terms-modal-header-top">
                            <div className="terms-modal-title">Access Declined</div>
                            <div className="terms-modal-logo">
                                <span className="legal-logo-k">Kengan</span>
                                <span className="legal-logo-s">Social</span>
                            </div>
                        </div>
                    </div>
                    <div className="terms-declined-state">
                        <div className="terms-declined-icon">🔒</div>
                        <div className="terms-declined-title">
                            You must accept our Terms to continue
                        </div>
                        <div className="terms-declined-sub">
                            KenganSocial cannot be used without agreeing to our Terms &amp;
                            Conditions and Privacy Policy. These agreements protect both you and
                            us and are required by South African law (POPIA) and international
                            data protection regulations.
                        </div>
                        <button
                            className="terms-btn-reconsider"
                            onClick={() => setDeclined(false)}
                        >
                            Review Terms Again
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── Main modal ──
    return (
        <div className="terms-modal-overlay">
            <div className="terms-modal">
                {/* Header */}
                <div className="terms-modal-header">
                    <div className="terms-modal-header-top">
                        <div className="terms-modal-title">Before you continue</div>
                        <div className="terms-modal-logo">
                            <span className="legal-logo-k">Kengan</span>
                            <span className="legal-logo-s">Social</span>
                        </div>
                    </div>
                    <div className="terms-modal-sub">
                        Please read and accept our Terms &amp; Conditions and Privacy Policy.
                        Effective March 2026 · Governed by South African law
                    </div>
                    <div className="terms-modal-progress">
                        <div
                            className="terms-modal-progress-fill"
                            style={{ width: `${scrollProgress * 100}%` }}
                        />
                    </div>
                    <div className="terms-modal-progress-label">
                        <span>{hasScrolledToBottom ? '✓ Reviewed' : 'Scroll to review'}</span>
                        <span>{Math.round(scrollProgress * 100)}% read</span>
                    </div>
                </div>

                {/* Scrollable body */}
                <div
                    className="terms-modal-scroll"
                    ref={scrollRef}
                    onScroll={handleScroll}
                >
                    {!hasScrolledToBottom && (
                        <div className="terms-read-prompt">
                            <span className="terms-read-prompt-icon">📋</span>
                            <span>
                                Please scroll through and read the key points below before
                                accepting. You can view the full legal documents at any time under{' '}
                                <strong>Settings → Legal</strong>.
                            </span>
                        </div>
                    )}

                    {hasScrolledToBottom && (
                        <div className="terms-accepted-banner">
                            <span className="terms-accepted-banner-icon">✅</span>
                            <div className="terms-accepted-banner-text">
                                <strong>Documents reviewed</strong>
                                You can now accept the Terms. You can always find the full
                                documents under Settings → Legal.
                            </div>
                        </div>
                    )}

                    {SUMMARY_POINTS.map((point, i) => (
                        <div key={i} className="terms-modal-section">
                            <div className="terms-modal-section-title">{point.heading}</div>
                            <div className="terms-modal-section-body">{point.body}</div>
                        </div>
                    ))}

                    {/* Link to full documents */}
                    <div className="terms-full-docs-box">
                        <strong>Full legal documents</strong>
                        These are summaries of the key points. The complete Terms &amp;
                        Conditions and Privacy Policy are available in the{' '}
                        <span
                            className="terms-full-docs-link"
                            onClick={() => navigate('/terms')}
                            role="link"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === 'Enter' && navigate('/terms')}
                        >
                            Legal section of your account settings
                        </span>
                        , or by visiting{' '}
                        <span
                            className="terms-full-docs-link"
                            onClick={() => navigate('/terms')}
                            role="link"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === 'Enter' && navigate('/terms')}
                        >
                            view full documents →
                        </span>
                        . Both documents are POPIA, GDPR, and CCPA compliant. Effective
                        date: March 2026.
                    </div>
                </div>

                {/* Footer — checkboxes + action buttons */}
                <div className="terms-modal-footer">
                    <div className="terms-modal-checkboxes">
                        <label className="terms-modal-checkbox-row">
                            <input
                                type="checkbox"
                                checked={checkedTerms}
                                onChange={(e) => setCheckedTerms(e.target.checked)}
                                id="terms-cb-terms"
                            />
                            <span className="terms-modal-checkbox-text">
                                I have read and agree to the{' '}
                                <b>Terms &amp; Conditions</b> of KenganSocial (Pty) Ltd,
                                including the Acceptable Use Policy and Subscription Terms.
                            </span>
                        </label>

                        <label className="terms-modal-checkbox-row">
                            <input
                                type="checkbox"
                                checked={checkedPrivacy}
                                onChange={(e) => setCheckedPrivacy(e.target.checked)}
                                id="terms-cb-privacy"
                            />
                            <span className="terms-modal-checkbox-text">
                                I have read and consent to the{' '}
                                <b>Privacy Policy</b>, including the processing of my personal
                                information in accordance with POPIA, and the connection of my
                                social media accounts.
                            </span>
                        </label>

                        <label className="terms-modal-checkbox-row">
                            <input
                                type="checkbox"
                                checked={checkedAge}
                                onChange={(e) => setCheckedAge(e.target.checked)}
                                id="terms-cb-age"
                            />
                            <span className="terms-modal-checkbox-text">
                                I confirm that I am <b>18 years of age or older</b> and have
                                the legal capacity to enter into this agreement.
                            </span>
                        </label>

                        <label className="terms-modal-checkbox-row">
                            <input
                                type="checkbox"
                                checked={checkedMarketing}
                                onChange={(e) => setCheckedMarketing(e.target.checked)}
                                id="terms-cb-marketing"
                            />
                            <span
                                className="terms-modal-checkbox-text"
                                style={{ opacity: 0.7 }}
                            >
                                <b>Optional:</b> I agree to receive product updates, tips, and
                                marketing communications from KenganSocial by email. I can
                                unsubscribe at any time.
                            </span>
                        </label>
                    </div>

                    <div className="terms-modal-btn-row">
                        <button
                            className="terms-btn-decline"
                            onClick={() => setDeclined(true)}
                        >
                            Decline
                        </button>
                        <button
                            className="terms-btn-accept"
                            disabled={!canAccept}
                            onClick={() =>
                                onAccept({
                                    termsAccepted: true,
                                    privacyAccepted: true,
                                    ageConfirmed: true,
                                    marketingConsent: checkedMarketing,
                                    acceptedAt: new Date().toISOString(),
                                    termsVersion: '1.0',
                                })
                            }
                        >
                            {canAccept
                                ? 'Accept & Continue →'
                                : 'Check all required boxes'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

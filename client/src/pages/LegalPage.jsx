import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './Legal.css';

// ─── FULL DOCUMENT CONTENT ────────────────────────────────────────────────────

const TERMS_CONTENT = {
    title: 'Terms & Conditions',
    effectiveDate: 'March 2026',
    lastUpdated: '15 October 2026',
    company: 'KenganSocial (Pty) Ltd',
    sections: [
        {
            id: 'definitions',
            heading: '1. Definitions & Interpretation',
            content: `In these Terms, unless the context otherwise requires:

"AI Credits" means the virtual currency used within the Platform to access AI-powered features, where 1 AI Credit equals 1 AI DM response, 1 caption generation, or approximately 250 tokens.

"API" means Application Programming Interface, being the technical interface through which the Platform connects to third-party social media platforms including TikTok, Instagram, YouTube, LinkedIn, Pinterest, and Threads.

"Content" means any text, images, videos, audio, data, or other materials created, uploaded, or generated through the Platform.

"Data Subject" has the meaning ascribed to it in POPIA, being the person to whom personal information relates.

"Personal Information" has the meaning ascribed to it in POPIA, including any information relating to an identifiable, living, natural person.

"Platform" means the KenganSocial SaaS platform, including all associated software, APIs, dashboards, and AI-powered automation tools.

"Processing" has the meaning ascribed to it in POPIA.

"Responsible Party" means KenganSocial as the entity determining the purpose and means of processing personal information.

"Subscription" means the recurring payment arrangement for access to the Platform's features.

"Working Days" means any day other than Saturday, Sunday, or a public holiday in the Republic of South Africa.`,
        },
        {
            id: 'services',
            heading: '2. Description of Services',
            content: `KenganSocial is a multi-channel AI automation platform designed for influencers, marketers, and agencies managing multiple social media accounts. The Platform provides:

— Multi-account management across TikTok, Instagram, YouTube, LinkedIn, Pinterest, and Threads
— AI-powered automated direct message (DM) responses and lead handling
— AI-generated content scripting and caption creation
— Short-form video editing with auto-captioning and viral clip detection
— Analytics dashboard and engagement tracking
— Automation rules engine for workflow creation

Service Availability: We strive to maintain Platform availability at 99.9% uptime, excluding scheduled maintenance. We will provide reasonable notice of scheduled maintenance where practicable.

Third-Party Dependencies: The Platform relies on third-party APIs provided by social media platforms. We do not guarantee uninterrupted access to these services and are not liable for disruption caused by changes to third-party API terms, pricing, or availability.`,
        },
        {
            id: 'accounts',
            heading: '3. User Accounts & Registration',
            content: `Eligibility: To register and use the Platform, you must be at least 18 years of age, have the legal capacity to enter into binding contracts, provide accurate and complete information during registration, and be authorised to connect and manage the social media accounts you link to the Platform.

Account Security: You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to use strong, unique passwords, enable two-factor authentication where available, immediately notify us of any unauthorised access, and not share your account credentials with any third party.

Multiple Accounts: Creating multiple accounts to circumvent plan limits is prohibited and will result in immediate termination of all associated accounts.`,
        },
        {
            id: 'billing',
            heading: '4. Subscription & Payment Terms',
            content: `Subscription Plans: KenganSocial offers a free plan and paid plans (Creator Starter, Creator Pro and Agency, with Enterprise by arrangement). Current prices and the limits each plan includes are published on the Pricing page at www.kengansocial.com/pricing. The Agency plan includes fair-use caps on compute-heavy resources; overages are billed at published rates.

Payment Terms: All payments are processed in South African Rand (ZAR). Plan fees are paid in advance for the period you choose (monthly or annually). South African VAT at 15% applies where applicable.

AI Usage: AI-powered features count against your plan's monthly AI allowance. Allowances reset monthly and unused allowance does not roll over.

Cancellation and Refunds: You may cancel your subscription at any time by emailing billing@kengansocial.com. Cancellation takes effect at the end of the current billing period. A 7-day cooling-off period applies to first-time paid subscriptions only. No partial refunds for unused time.

Consumer Protection Act Compliance: In accordance with Section 14 of the CPA 68 of 2008, you have the right to cancel any fixed-term agreement by giving 20 business days' written notice to billing@kengansocial.com.`,
        },
        {
            id: 'acceptable-use',
            heading: '5. Acceptable Use Policy',
            content: `You agree NOT to use the Platform to:

— Violate any applicable laws, regulations, or third-party rights
— Send spam, unsolicited messages, or engage in any form of harassment
— Distribute malware, viruses, or any harmful code
— Attempt to gain unauthorised access to the Platform or connected accounts
— Interfere with the integrity or performance of the Platform
— Generate or distribute content that is illegal, harmful, threatening, abusive, defamatory, or discriminatory
— Circumvent API rate limits or abuse the AI Credit system
— Resell, sublicense, or commercially exploit the Platform without authorisation

Content Standards: You are solely responsible for all Content you create, upload, or distribute through the Platform. You represent that you own or have obtained all necessary rights to the Content and that it complies with the terms of service of all connected social media platforms.

Enforcement: We reserve the right to suspend or terminate your account, without prior notice, for any violation of this Acceptable Use Policy. We may also report illegal activities to appropriate law enforcement authorities.`,
        },
        {
            id: 'ip',
            heading: '6. Intellectual Property Rights',
            content: `Platform Ownership: All Intellectual Property rights in and to the Platform, including software, algorithms, designs, logos, and documentation, are and shall remain the exclusive property of KenganSocial or its licensors.

User Content Licence: You retain all ownership rights to Content you create using the Platform. By using the Platform, you grant KenganSocial a limited, non-exclusive, royalty-free licence to process your Content as necessary to provide the Service, store and transmit your Content to connected social media platforms, and use anonymised data for improving our AI models.

AI-Generated Content: Content generated by our AI tools is provided for your use. You are responsible for reviewing and ensuring the appropriateness of AI-generated Content before publication. We make no representations regarding the originality or non-infringement of AI-generated Content.`,
        },
        {
            id: 'data',
            heading: '7. Data Protection & Privacy',
            content: `POPIA Compliance: KenganSocial is committed to protecting your personal information in accordance with the Protection of Personal Information Act 4 of 2013 (POPIA). As a Responsible Party, we process personal information lawfully, minimally, and for specified purposes; implement appropriate technical and organizational security measures; ensure personal information is accurate and up to date; retain personal information only as long as necessary; and respect your rights as a Data Subject under POPIA.

Information Officer: Our Information Officer oversees POPIA compliance. Contact: privacy@kengansocial.com

Data Subject Rights: Under POPIA, you have the right to request access to your personal information (Section 23), request correction or deletion (Section 24), object to processing (Section 11), and lodge a complaint with the Information Regulator.

For detailed information about how we collect, use, and protect personal information, please refer to our Privacy Policy, which forms part of these Terms.`,
        },
        {
            id: 'liability',
            heading: '8. Limitation of Liability',
            content: `Disclaimer of Warranties: The Platform is provided "as is" and "as available" without warranties of any kind. To the maximum extent permitted by law, we disclaim all warranties, including implied warranties of merchantability and fitness for a particular purpose.

Limitation: To the maximum extent permitted by applicable law, KenganSocial shall not be liable for any indirect, incidental, special, consequential, or punitive damages; loss of profits, revenue, data, or business opportunities; damages arising from third-party platform changes or API limitations; or damages exceeding the total amount paid by you to KenganSocial in the twelve months preceding the claim.

CPA Notice: Nothing in these Terms excludes or limits liability for gross negligence, wilful misconduct, fraud, or any other liability that cannot be excluded under the Consumer Protection Act 68 of 2008 or any other applicable law.`,
        },
        {
            id: 'termination',
            heading: '9. Termination',
            content: `Termination by User: You may terminate your account at any time by emailing billing@kengansocial.com (to cancel a paid plan) or privacy@kengansocial.com (to delete your account and data). Access will cease at the end of the current billing period.

Termination by KenganSocial: We may suspend or terminate your account immediately, without prior notice, if you breach any provision of these Terms, we are required to do so by law, your use poses a security risk, you fail to pay any due amounts, or we discontinue the Platform.

Effect of Termination: Upon termination, all licences granted under these Terms shall immediately terminate. We may delete your account data in accordance with our data retention policies (30 days retention for export before permanent deletion).`,
        },
        {
            id: 'disputes',
            heading: '10. Dispute Resolution',
            content: `Negotiation: The parties agree to first attempt to resolve disputes through good faith negotiation. Either party may initiate negotiation by providing written notice.

Mediation: If the dispute cannot be resolved through negotiation within 30 days, the parties agree to submit to mediation under the rules of the Arbitration Foundation of Southern Africa (AFSA).

Arbitration: If mediation fails within 60 days, the dispute shall be resolved by arbitration under AFSA rules, conducted in English in Johannesburg, South Africa, by a single arbitrator appointed by AFSA.

Governing Law: These Terms are governed by and construed in accordance with the laws of the Republic of South Africa.`,
        },
        {
            id: 'general',
            heading: '11. General Provisions',
            content: `Entire Agreement: These Terms, together with our Privacy Policy, constitute the entire agreement between you and KenganSocial regarding the use of the Platform.

Amendment: We reserve the right to modify these Terms at any time. Material changes will be notified via email or through the Platform at least 30 days before becoming effective. Continued use constitutes acceptance.

Severability: If any provision of these Terms is found invalid or unenforceable, the remaining provisions shall continue in full force and effect.

Force Majeure: Neither party shall be liable for failure or delay in performance due to circumstances beyond their reasonable control.`,
        },
        {
            id: 'contact',
            heading: '12. Contact Information',
            content: `For any questions, concerns, or inquiries regarding these Terms:

KenganSocial (Pty) Ltd
Email: info@kengansocial.com
Website: www.kengansocial.com
Data Protection Officer: privacy@kengansocial.com

By using the KenganSocial Platform, you acknowledge that you have read, understood, and agree to be bound by these Terms and Conditions.`,
        },
    ],
};

const PRIVACY_CONTENT = {
    title: 'Privacy Policy',
    effectiveDate: 'March 2026',
    lastUpdated: 'March 2026',
    company: 'KenganSocial (Pty) Ltd',
    compliance: ['POPIA (South Africa)', 'GDPR (EU)', 'CCPA (California)'],
    sections: [
        {
            id: 'intro',
            heading: '1. Introduction',
            content: `KenganSocial (Pty) Ltd is committed to protecting your privacy and ensuring the security of your personal information. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our AI-powered multi-channel social media automation platform.

This Privacy Policy applies to all users including individual content creators and influencers, marketing professionals and agencies, enterprise clients and brand managers, and visitors to our website.

By accessing or using our Platform, you consent to the practices described in this Privacy Policy.

Information Officer: Our appointed Information Officer oversees POPIA compliance. Contact: privacy@kengansocial.com`,
        },
        {
            id: 'collection',
            heading: '2. Information We Collect',
            content: `Personal Information You Provide: We collect information when you register for an account (name, email address, phone number, company name), connect social media accounts (platform usernames, profile information, access tokens), create automation workflows (trigger keywords, response templates), upload content for AI processing (videos, images, text), contact our support team, or make payments.

Information Collected Automatically: We automatically collect device information (IP address, browser type, operating system), usage data (features accessed, actions taken, timestamps), log data (error reports, performance metrics, API interactions), and location information (general geographic location based on IP address).

Information from Third Parties: We receive information from social media platforms when you authorise connection, authentication providers (Google) when you use single sign-on, and payment processors (transaction confirmation only).

AI-Processed Content: Our AI systems process content you submit to generate responses, captions, and edited videos. Anonymised data may be used to improve our AI models.`,
        },
        {
            id: 'use',
            heading: '3. How We Use Your Information',
            content: `Service Provision: Creating and managing your account, providing access to Platform features, processing AI automation requests, connecting to and managing your linked social media accounts, and processing payments and managing subscriptions.

Service Improvement: Analysing usage patterns to improve Platform functionality, training and improving our AI models using anonymised data, debugging errors and optimising performance, and conducting research and development activities.

Communication: Sending service-related notifications, providing customer support, sending marketing communications (with your consent, which can be withdrawn), and conducting surveys.

Security and Compliance: Detecting and preventing fraud and unauthorised access, complying with legal obligations, enforcing our Terms and Conditions, and protecting our rights, property, and safety.`,
        },
        {
            id: 'legal-basis',
            heading: '4. Legal Basis for Processing',
            content: `POPIA (South Africa): Under Section 11 of POPIA, we process personal information where processing is necessary for the performance of a contract (your use of our Platform), required to comply with legal obligations, necessary to protect legitimate interests, or you have provided consent for marketing communications and optional features.

GDPR (European Union): For users in the EEA, we process personal data under Article 6 based on contractual necessity (Article 6(1)(b)), legal obligation (Article 6(1)(c)), legitimate interests (Article 6(1)(f)), and consent (Article 6(1)(a)) for optional processing activities.

CCPA (California): For California residents, we collect personal information for the business purposes described in this Privacy Policy. We do not sell personal information as defined by the CCPA.`,
        },
        {
            id: 'sharing',
            heading: '5. Data Sharing & Disclosure',
            content: `Third-Party Service Providers: We engage trusted third-party providers including Google Cloud Platform (Firebase authentication and database), Paystack (payment processing), Anthropic/OpenAI (AI processing and generation), SendGrid (email delivery), and AssemblyAI/Google Video Intelligence (video processing).

Social Media Platforms: When you connect your social media accounts, we share necessary information with these platforms to enable automation features. This sharing is governed by the privacy policies and terms of service of each platform.

Legal Requirements: We may disclose your information where required by law, including compliance with court orders, protection of our rights, prevention or investigation of fraud, and response to lawful requests from public authorities.

Business Transfers: In the event of a merger, acquisition, or sale of assets, your information may be transferred. We will notify you of any such change in ownership.`,
        },
        {
            id: 'security',
            heading: '6. Data Security',
            content: `Security Measures: We implement comprehensive technical and organizational security measures including encryption of data in transit (TLS 1.3) and at rest (AES-256), multi-factor authentication options, regular security audits, role-based access controls, secure development practices, and incident response and breach notification procedures.

OAuth Token Protection: All OAuth tokens connecting your social media accounts are encrypted using AES-256-GCM before storage. Decryption occurs only server-side — tokens are never exposed to the frontend or stored in plaintext.

POPIA Section 19 Compliance: We take appropriate technical and organisational measures to prevent loss of, damage to, or unauthorised destruction of personal information, and unlawful access to or processing of personal information.`,
        },
        {
            id: 'rights',
            heading: '7. Your Rights',
            content: `POPIA Rights (South Africa): Under POPIA, you have the right to access your personal information, request correction of inaccurate data, request deletion of your personal information, object to processing of your personal information, and lodge a complaint with the Information Regulator (www.inforegulator.org.za).

GDPR Rights (EU): Under the GDPR, you have the right to access (Article 15), rectification (Article 16), erasure / "right to be forgotten" (Article 17), restriction of processing (Article 18), data portability (Article 20), object to processing (Article 21), and withdraw consent at any time (Article 7).

CCPA Rights (California): California residents have the right to know what personal information is collected, know whether it is sold or disclosed, say no to the sale of personal information, and access their personal information.

Exercising Your Rights: Contact us at privacy@kengansocial.com. We will respond within 30 days as required by applicable law. We may need to verify your identity before processing your request.`,
        },
        {
            id: 'cookies',
            heading: '8. Cookies & Tracking',
            content: `Types of Cookies We Use:
— Essential cookies: Required for Platform functionality (authentication, security). Duration: Session to 1 year.
— Functional cookies: Remember preferences and settings. Duration: 1 year.
— Analytics cookies: Understand usage patterns and improve service. Duration: 2 years.
— Security cookies: Detect malicious activity and protect users. Duration: Session.

Cookie Management: You can manage cookie preferences through your browser settings. Disabling certain cookies may affect Platform functionality.

Analytics: We use analytics tools (Google Analytics) to understand how users interact with our Platform. We do not use advertising cookies or engage in targeted advertising.`,
        },
        {
            id: 'transfers',
            heading: '9. International Data Transfers',
            content: `Transfer Mechanisms: Your personal information may be transferred to and processed in countries outside your jurisdiction. We ensure appropriate safeguards including Standard Contractual Clauses (SCCs) approved by the European Commission and adequacy decisions for countries with recognised adequate protection.

POPIA Section 72 Compliance: Under Section 72 of POPIA, we may only transfer personal information outside South Africa where the recipient country has adequate data protection laws, or where we have implemented appropriate safeguards.

Service Provider Locations: Our service providers may process data in South Africa (primary), the United States (cloud infrastructure — AWS, Google Cloud), and the European Union (backup and redundancy).`,
        },
        {
            id: 'retention',
            heading: '10. Data Retention',
            content: `Retention Periods:
— Account information: Retained while your account is active.
— Transaction records: Retained for 5 years (tax and accounting requirements).
— Usage logs: Retained for 12 months (security and debugging).
— Marketing data: Retained until you withdraw consent.
— Deleted account data: Retained for 30 days then permanently deleted.

POPIA Section 14 Compliance: We retain personal information only for as long as necessary to achieve the purpose for which it was collected, unless retention is required by law.`,
        },
        {
            id: 'children',
            heading: "11. Children's Privacy",
            content: `Our Platform is not intended for use by individuals under the age of 18. We do not knowingly collect personal information from children under 18. If we become aware that we have collected personal information from a child under 18, we will take steps to delete such information promptly.

If you are a parent or guardian and believe your child has provided us with personal information, please contact us at privacy@kengansocial.com.`,
        },
        {
            id: 'changes',
            heading: '12. Changes to This Privacy Policy',
            content: `We may update this Privacy Policy from time to time. We will notify you of material changes by posting the updated Privacy Policy on our website, sending an email notification to registered users, and displaying a prominent notice within the Platform.

Your continued use of the Platform after any changes constitutes acceptance of the updated Privacy Policy.`,
        },
        {
            id: 'contact-privacy',
            heading: '13. Contact Us',
            content: `KenganSocial (Pty) Ltd
Email: privacy@kengansocial.com
General Inquiries: info@kengansocial.com
Website: www.kengansocial.com

Information Regulator (South Africa):
Website: www.inforegulator.org.za
Email: inforeg@justice.gov.za

EU residents may contact their local data protection authority for GDPR-related complaints.`,
        },
    ],
};

// ─── LEGAL PAGE ───────────────────────────────────────────────────────────────
export default function LegalPage() {
    const navigate = useNavigate();
    const [activeDoc, setActiveDoc] = useState('terms');
    const [activeSection, setActiveSection] = useState(null);
    const doc = activeDoc === 'terms' ? TERMS_CONTENT : PRIVACY_CONTENT;

    const scrollToSection = (id) => {
        const el = document.getElementById(`section-${id}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setActiveSection(id);
    };

    return (
        <div className="legal-root">
            {/* Sticky nav */}
            <nav className="legal-nav">
                <Link to="/" className="legal-nav-logo">
                    <span className="legal-logo-k">Kengan</span>
                    <span className="legal-logo-s">Social</span>
                </Link>
                <div className="legal-nav-tabs">
                    <button
                        className={`legal-nav-tab ${activeDoc === 'terms' ? 'active' : ''}`}
                        onClick={() => setActiveDoc('terms')}
                    >
                        Terms &amp; Conditions
                    </button>
                    <button
                        className={`legal-nav-tab ${activeDoc === 'privacy' ? 'active' : ''}`}
                        onClick={() => setActiveDoc('privacy')}
                    >
                        Privacy Policy
                    </button>
                </div>
                <button className="legal-nav-back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
                    ← Back
                </button>
            </nav>

            {/* Hero */}
            <div className="legal-hero">
                <div className="legal-hero-label">Legal Documents</div>
                <div className="legal-hero-title">
                    {activeDoc === 'terms' ? 'Terms & Conditions' : 'Privacy Policy'}
                </div>
                <div className="legal-hero-sub">
                    {activeDoc === 'terms'
                        ? 'The legally binding agreement governing your use of the KenganSocial platform. Governed by the laws of the Republic of South Africa.'
                        : 'How KenganSocial collects, uses, and protects your personal information. Compliant with POPIA, GDPR, and CCPA.'}
                </div>
                <div className="compliance-chips">
                    <span className="compliance-chip">POPIA 2013</span>
                    <span className="compliance-chip">ECTA 2002</span>
                    <span className="compliance-chip">CPA 2008</span>
                    {activeDoc === 'privacy' && (
                        <>
                            <span className="compliance-chip">GDPR</span>
                            <span className="compliance-chip">CCPA</span>
                        </>
                    )}
                </div>
            </div>

            {/* Two-column layout */}
            <div className="legal-layout">
                {/* Sidebar */}
                <aside className="legal-sidebar">
                    <div className="legal-sidebar-label" style={{ marginBottom: 4 }}>
                        Documents
                    </div>
                    <button
                        className={`legal-sidebar-link ${activeDoc === 'terms' ? 'active' : ''}`}
                        onClick={() => setActiveDoc('terms')}
                    >
                        Terms &amp; Conditions
                    </button>
                    <button
                        className={`legal-sidebar-link ${activeDoc === 'privacy' ? 'active' : ''}`}
                        onClick={() => setActiveDoc('privacy')}
                    >
                        Privacy Policy
                    </button>
                    <div className="legal-sidebar-divider" />
                    <div className="legal-sidebar-label">Sections</div>
                    {doc.sections.map((s) => (
                        <button
                            key={s.id}
                            className={`legal-sidebar-link ${activeSection === s.id ? 'active' : ''}`}
                            onClick={() => scrollToSection(s.id)}
                        >
                            {s.heading}
                        </button>
                    ))}
                </aside>

                {/* Main content */}
                <main className="legal-content">
                    <div className="legal-doc-header">
                        <div className="legal-doc-title">{doc.title}</div>
                        <div className="legal-doc-meta">
                            {doc.company} &nbsp;·&nbsp; Effective:{' '}
                            <span>{doc.effectiveDate}</span>
                            {doc.lastUpdated && (
                                <>
                                    &nbsp;·&nbsp; Last Updated:{' '}
                                    <span>{doc.lastUpdated}</span>
                                </>
                            )}
                        </div>
                    </div>

                    {doc.sections.map((section, i) => (
                        <div
                            key={section.id}
                            id={`section-${section.id}`}
                            className="legal-section"
                        >
                            <div className="legal-section-heading">
                                <span className="legal-section-num">{i + 1}</span>
                                {section.heading.replace(/^\d+\.\s*/, '')}
                            </div>
                            <div className="legal-section-body">{section.content}</div>
                        </div>
                    ))}
                </main>
            </div>

            {/* Contact footer */}
            <div className="legal-contact-footer">
                <span>📧 privacy@kengansocial.com</span>
                <span>📧 info@kengansocial.com</span>
                <span>🌐 www.kengansocial.com</span>
                <span>🏛 Information Regulator: inforegulator.org.za</span>
            </div>
        </div>
    );
}

import LandingNavbar from '../components/layout/LandingNavbar';
import './LandingPage.css';

export default function PrivacyPolicyPage() {
    return (
        <div className="landing-page bg-primary" style={{ minHeight: '100vh', paddingBottom: '100px' }}>
            <div className="bg-grid absolute-inset" />
            <div className="bg-glow absolute-inset" />

            <LandingNavbar />

            <main className="container animate-slide-in" style={{ marginTop: '120px', position: 'relative', zIndex: 10 }}>
                <div style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'left', background: 'var(--bg-secondary)', padding: '60px', borderRadius: '16px', border: '1px solid var(--border-color)' }}>
                    <div className="badge badge-brand" style={{ marginBottom: '24px' }}>
                        <span className="badge-dot" /> Legal
                    </div>

                    <h1 style={{ fontSize: '2.5rem', fontWeight: '800', marginBottom: '24px', lineHeight: '1.2' }}>
                        Privacy Policy
                    </h1>

                    <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', marginBottom: '48px', lineHeight: '1.6' }}>
                        Last updated: 15 October 2026
                    </p>

                    <h3 style={{ fontSize: '1.4rem', marginBottom: '16px', color: 'var(--text-primary)' }}>1. Data Collection</h3>
                    <p style={{ color: 'var(--text-secondary)', lineHeight: '1.8', marginBottom: '32px' }}>
                        When you connect your social media profiles using official OAuth integrations, we only request the permissions required to carry out the core services, such as creating posts on your behalf. We securely store access tokens, and do not access or store your social platform passwords.
                    </p>

                    <h3 style={{ fontSize: '1.4rem', marginBottom: '16px', color: 'var(--text-primary)' }}>2. AI Content & Generation</h3>
                    <p style={{ color: 'var(--text-secondary)', lineHeight: '1.8', marginBottom: '32px' }}>
                        The content you generate using our AI pipeline is temporarily processed via secure endpoints (such as OpenAI/Gemini/Auphonic). These third-party services do not use your private generational data to train public foundation models without explicit consent.
                    </p>

                    <h3 style={{ fontSize: '1.4rem', marginBottom: '16px', color: 'var(--text-primary)' }}>3. Storage & Analytics</h3>
                    <p style={{ color: 'var(--text-secondary)', lineHeight: '1.8', marginBottom: '32px' }}>
                        Your drafts, uploaded media assets, and historical metrics are stored securely within Firebase. You retain full ownership of any content you upload, schedule, or publish via KenganSocial. To delete your workspace and its data, email <a href="mailto:privacy@kengansocial.com?subject=Delete%20my%20workspace" style={{ color: 'var(--accent-text)' }}>privacy@kengansocial.com</a> from the address on your account. We confirm the request and delete the data as required by POPIA. To cancel a paid plan, email <a href="mailto:billing@kengansocial.com" style={{ color: 'var(--accent-text)' }}>billing@kengansocial.com</a>.
                    </p>

                    <h3 style={{ fontSize: '1.4rem', marginBottom: '16px', color: 'var(--text-primary)' }}>4. Security</h3>
                    <p style={{ color: 'var(--text-secondary)', lineHeight: '1.8', marginBottom: '32px' }}>
                        We employ industry-standard encryption protocols (TLS) for all data requests. However, no data transmission over the Internet or electronic storage is entirely secure; as such, we cannot guarantee absolute security but strive to protect your sensitive authentication tokens.
                    </p>

                </div>
            </main>
        </div>
    );
}

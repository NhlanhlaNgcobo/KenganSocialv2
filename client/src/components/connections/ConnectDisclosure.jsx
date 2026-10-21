/**
 * Shown before sending someone to a platform's sign-in: what KenganSocial will access and why,
 * the platform terms that apply, and how to disconnect. Covers platform policy disclosures:
 * YouTube API Services (YouTube ToS + Google Privacy Policy), Meta Developer Policies 5.8a
 * (Instagram messages visible to Page managers), TikTok (what is accessed, revocation).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, X } from 'lucide-react';

const COPY = {
    youtube: {
        name: 'YouTube',
        access: ['Your channel name, picture and subscriber count', 'Upload videos you create or schedule here', 'List your videos and show their comments', 'Read your channel analytics'],
        terms: (
            <>
                KenganSocial uses YouTube API Services. By connecting, you agree to the{' '}
                <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube Terms of Service</a>; Google’s use of your data is described in the{' '}
                <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google Privacy Policy</a>. You can revoke access any time in your{' '}
                <a href="https://security.google.com/settings/security/permissions" target="_blank" rel="noreferrer">Google security settings</a>.
            </>
        ),
    },
    instagram: {
        name: 'Instagram',
        access: ['Your professional account’s username and follower count', 'Publish Reels you create or schedule here', 'Read insights for your account', 'Read and answer direct messages in your inbox, including automated replies you switch on'],
        acknowledge: 'I understand that Instagram messages will be visible to people who manage the linked Facebook Page, and to members of this workspace who can open the inbox.',
        terms: (
            <>
                Your use of Instagram stays subject to the <a href="https://help.instagram.com/581066165581870" target="_blank" rel="noreferrer">Instagram Terms of Use</a>. Instagram needs a professional (Business or Creator) account linked to a Facebook Page.
            </>
        ),
    },
    facebook: {
        name: 'Facebook',
        access: ['Your Page’s name, picture and follower count', 'Publish posts and videos you create or schedule to that Page'],
        terms: (
            <>
                Your use of Facebook stays subject to the <a href="https://www.facebook.com/terms.php" target="_blank" rel="noreferrer">Meta Terms of Service</a>. You choose which Page to share in Facebook’s dialog.
            </>
        ),
    },
    tiktok: {
        name: 'TikTok',
        access: ['Your TikTok display name and avatar', 'Post videos you create here, with the privacy and interaction settings you choose on each post'],
        terms: (
            <>
                Your use of TikTok stays subject to the <a href="https://www.tiktok.com/legal/page/global/terms-of-service/en" target="_blank" rel="noreferrer">TikTok Terms of Service</a>. When you post, you agree to TikTok’s{' '}
                <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer">Music Usage Confirmation</a>.
            </>
        ),
    },
};

export default function ConnectDisclosure({ platform, onContinue, onCancel }) {
    const copy = COPY[platform];
    const [acknowledged, setAcknowledged] = useState(!copy?.acknowledge);
    if (!copy) return null;
    return (
        <div className="cd-overlay" role="dialog" aria-modal="true" aria-labelledby="cd-title" onClick={onCancel}>
            <div className="cd-card card" onClick={(e) => e.stopPropagation()}>
                <button className="cd-close btn-icon btn-ghost" onClick={onCancel} aria-label="Close">
                    <X size={18} />
                </button>
                <h3 id="cd-title">
                    <ShieldCheck size={20} /> Connect {copy.name}
                </h3>
                <p className="cd-lead">You’ll sign in with {copy.name} and choose what to allow. KenganSocial will use that access only to do what you ask here:</p>
                <ul className="cd-list">
                    {copy.access.map((item) => (
                        <li key={item}>{item}</li>
                    ))}
                </ul>
                <p className="cd-terms">{copy.terms}</p>
                <p className="cd-terms">
                    Disconnect any time here: we revoke our access and delete the data this connection brought in. Details in our <Link to="/privacy">Privacy Policy</Link>.
                </p>
                {copy.acknowledge ? (
                    <label className="cd-ack">
                        <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                        <span>{copy.acknowledge}</span>
                    </label>
                ) : null}
                <div className="cd-actions">
                    <button className="btn btn-secondary" onClick={onCancel}>
                        Cancel
                    </button>
                    <button className="btn btn-primary" onClick={onContinue} disabled={!acknowledged}>
                        Continue to {copy.name}
                    </button>
                </div>
            </div>
        </div>
    );
}

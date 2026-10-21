/**
 * Per-platform post settings in the scheduler.
 *
 * TikTok follows TikTok's Content Sharing Guidelines for Direct Post
 * (https://developers.tiktok.com/doc/content-sharing-guidelines): the creator's nickname from
 * creator_info, no posting when TikTok says the creator can't post now, a privacy dropdown with
 * only the allowed options and no default, comment/duet/stitch unchecked by default and greyed
 * out when the creator turned them off, the commercial content disclosure with its labels,
 * the maximum video length, a preview, and the consent text above the publish button.
 *
 * YouTube asks for visibility and the "made for kids" declaration (no defaults).
 */
import { useEffect, useMemo, useState } from 'react';
import { Info, Loader2 } from 'lucide-react';
import { apiClient } from '../../lib/api';

export interface TikTokOptions {
    privacyLevel?: string;
    allowComment?: boolean;
    allowDuet?: boolean;
    allowStitch?: boolean;
    disclose?: boolean;
    yourBrand?: boolean;
    brandedContent?: boolean;
    isAigc?: boolean;
}

export interface TikTokCreatorInfo {
    /** 'inbox': videos go to the creator's TikTok inbox and they finish posting in TikTok. */
    mode?: 'direct' | 'inbox';
    nickname: string;
    username: string;
    avatarUrl: string;
    privacyLevelOptions: string[];
    commentDisabled: boolean;
    duetDisabled: boolean;
    stitchDisabled: boolean;
    maxVideoPostDurationSec: number | null;
    canPost: boolean;
    reason: string | null;
    error?: string;
}

const PRIVACY_LABELS: Record<string, string> = {
    PUBLIC_TO_EVERYONE: 'Everyone',
    MUTUAL_FOLLOW_FRIENDS: 'Friends',
    FOLLOWER_OF_CREATOR: 'Followers',
    SELF_ONLY: 'Only me',
};

const MUSIC_URL = 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en';
const BRANDED_URL = 'https://www.tiktok.com/legal/page/global/bc-policy/en';

/** Why the TikTok settings can't be posted yet, or '' when they can. */
export function tiktokProblem(o: TikTokOptions, info: TikTokCreatorInfo | null, videoSeconds: number | null): string {
    if (!info) return 'Loading your TikTok posting options…';
    if (info.error) return `TikTok: ${info.error}`;
    if (info.mode === 'inbox') return '';
    if (!info.canPost) return `TikTok says you can't post right now${info.reason ? ` (${info.reason})` : ''}. Try again later.`;
    if (!o.privacyLevel) return 'Choose who can view the TikTok post.';
    if (!info.privacyLevelOptions.includes(o.privacyLevel)) return 'That TikTok privacy option is not available for your account.';
    if (o.disclose && !o.yourBrand && !o.brandedContent) return 'You need to indicate if your content promotes yourself, a third party, or both.';
    if (o.disclose && o.brandedContent && o.privacyLevel === 'SELF_ONLY') return "Branded content visibility can't be set to private.";
    if (videoSeconds && info.maxVideoPostDurationSec && videoSeconds > info.maxVideoPostDurationSec) return `This video is ${Math.round(videoSeconds)}s; your TikTok account allows up to ${info.maxVideoPostDurationSec}s.`;
    return '';
}

/** The TikTok consent sentence that must sit above the publish button. */
export function TikTokConsent({ options }: { options: TikTokOptions }) {
    const branded = options.disclose && options.brandedContent;
    return (
        <p className="tt-consent">
            By posting, you agree to TikTok&apos;s{' '}
            {branded ? (
                <>
                    <a href={BRANDED_URL} target="_blank" rel="noreferrer">Branded Content Policy</a> and{' '}
                </>
            ) : null}
            <a href={MUSIC_URL} target="_blank" rel="noreferrer">Music Usage Confirmation</a>.
        </p>
    );
}

export function useVideoSeconds(file: File | null) {
    const [seconds, setSeconds] = useState<number | null>(null);
    useEffect(() => {
        setSeconds(null);
        if (!file || !file.type.startsWith('video/')) return undefined;
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => setSeconds(Number.isFinite(v.duration) ? v.duration : null);
        v.src = url;
        return () => URL.revokeObjectURL(url);
    }, [file]);
    return seconds;
}

export function useTikTokCreatorInfo(enabled: boolean) {
    const [info, setInfo] = useState<TikTokCreatorInfo | null>(null);
    useEffect(() => {
        if (!enabled) return undefined;
        let cancelled = false;
        setInfo(null);
        apiClient('/connections/tiktok/creator-info')
            .then((data: TikTokCreatorInfo) => !cancelled && setInfo(data))
            .catch((err: Error) => !cancelled && setInfo({ nickname: '', username: '', avatarUrl: '', privacyLevelOptions: [], commentDisabled: true, duetDisabled: true, stitchDisabled: true, maxVideoPostDurationSec: null, canPost: false, reason: null, error: err.message }));
        return () => {
            cancelled = true;
        };
    }, [enabled]);
    return info;
}

export function TikTokPostSettings({ value, onChange, info, mediaFile, videoSeconds }: { value: TikTokOptions; onChange: (v: TikTokOptions) => void; info: TikTokCreatorInfo | null; mediaFile: File | null; videoSeconds: number | null }) {
    const set = (patch: Partial<TikTokOptions>) => onChange({ ...value, ...patch });
    const previewUrl = useMemo(() => (mediaFile ? URL.createObjectURL(mediaFile) : ''), [mediaFile]);
    useEffect(() => () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
    }, [previewUrl]);
    const branded = !!(value.disclose && value.brandedContent);
    const problem = tiktokProblem(value, info, videoSeconds);

    if (!info) {
        return (
            <div className="tt-settings">
                <p className="cal-text-muted"><Loader2 size={14} className="spin" /> Loading your TikTok posting options…</p>
            </div>
        );
    }
    if (info.mode === 'inbox') {
        return (
            <div className="tt-settings">
                <p className="cal-text-muted">
                    <Info size={13} /> The video goes to your TikTok inbox. Open TikTok to choose who can see it, add any disclosure and post it.
                </p>
            </div>
        );
    }
    if (info.error || !info.canPost) {
        return (
            <div className="tt-settings">
                <p className="cal-form-error" role="alert">{problem}</p>
            </div>
        );
    }

    return (
        <div className="tt-settings">
            <div className="tt-creator">
                {info.avatarUrl ? <img src={info.avatarUrl} alt="" /> : null}
                <span>
                    Posting to <strong>{info.nickname || info.username}</strong>
                    {info.username ? <span className="cal-text-muted"> @{info.username}</span> : null}
                </span>
            </div>

            {previewUrl && mediaFile?.type.startsWith('video/') ? <video className="tt-preview" src={previewUrl} controls muted playsInline /> : null}
            {info.maxVideoPostDurationSec ? (
                <small className="cal-text-muted">
                    Your account can post videos up to {info.maxVideoPostDurationSec}s{videoSeconds ? `; this video is ${Math.round(videoSeconds)}s` : ''}.
                </small>
            ) : null}

            <label className="field">
                <span>Who can view this video</span>
                <select className="input" value={value.privacyLevel || ''} onChange={(e) => set({ privacyLevel: e.target.value || undefined })} aria-label="TikTok privacy">
                    <option value="" disabled>
                        Select privacy
                    </option>
                    {info.privacyLevelOptions.map((o) => (
                        <option key={o} value={o} disabled={branded && o === 'SELF_ONLY'} title={branded && o === 'SELF_ONLY' ? "Branded content visibility can't be set to private." : undefined}>
                            {PRIVACY_LABELS[o] || o}
                            {branded && o === 'SELF_ONLY' ? ' (not available for branded content)' : ''}
                        </option>
                    ))}
                </select>
            </label>

            <div className="field">
                <span>Allow users to</span>
                <div className="tt-checks">
                    {(
                        [
                            ['allowComment', 'Comment', info.commentDisabled],
                            ['allowDuet', 'Duet', info.duetDisabled],
                            ['allowStitch', 'Stitch', info.stitchDisabled],
                        ] as const
                    ).map(([key, label, disabled]) => (
                        <label key={key} className={disabled ? 'is-disabled' : ''} title={disabled ? `${label} is turned off in your TikTok settings.` : undefined}>
                            <input type="checkbox" checked={!disabled && !!value[key]} disabled={disabled} onChange={(e) => set({ [key]: e.target.checked })} /> {label}
                        </label>
                    ))}
                </div>
            </div>

            <div className="field">
                <label className="tt-toggle">
                    <input
                        type="checkbox"
                        checked={!!value.disclose}
                        onChange={(e) => set({ disclose: e.target.checked, ...(e.target.checked ? {} : { yourBrand: false, brandedContent: false }) })}
                    />
                    <span>
                        <strong>Disclose video content</strong>
                        <small className="cal-text-muted">Turn on to disclose that this video promotes goods or services in exchange for something of value.</small>
                    </span>
                </label>
                {value.disclose ? (
                    <div className="tt-disclose">
                        <label>
                            <input type="checkbox" checked={!!value.yourBrand} onChange={(e) => set({ yourBrand: e.target.checked })} />
                            <span>
                                <strong>Your brand</strong>
                                <small className="cal-text-muted">You are promoting yourself or your own business. This video will be classified as Brand Organic.</small>
                            </span>
                        </label>
                        <label>
                            <input
                                type="checkbox"
                                checked={!!value.brandedContent}
                                onChange={(e) => set({ brandedContent: e.target.checked, ...(e.target.checked && value.privacyLevel === 'SELF_ONLY' ? { privacyLevel: undefined } : {}) })}
                            />
                            <span>
                                <strong>Branded content</strong>
                                <small className="cal-text-muted">You are promoting another brand or a third party. This video will be classified as Branded Content.</small>
                            </span>
                        </label>
                        {value.yourBrand || value.brandedContent ? (
                            <p className="tt-label-note">
                                <Info size={13} /> Your video will be labeled as &quot;{value.brandedContent ? 'Paid partnership' : 'Promotional content'}&quot;.
                            </p>
                        ) : (
                            <p className="cal-form-error">You need to indicate if your content promotes yourself, a third party, or both.</p>
                        )}
                    </div>
                ) : null}
            </div>

            <label className="tt-toggle">
                <input type="checkbox" checked={!!value.isAigc} onChange={(e) => set({ isAigc: e.target.checked })} />
                <span>
                    <strong>AI-generated content</strong>
                    <small className="cal-text-muted">Label this video as made or significantly edited with AI.</small>
                </span>
            </label>

            {problem ? <p className="cal-form-error">{problem}</p> : null}
            <TikTokConsent options={value} />
            <small className="cal-text-muted">After it is published, it can take a few minutes for the video to appear on your TikTok profile.</small>
        </div>
    );
}

export interface YouTubeOptions {
    privacyStatus?: 'public' | 'unlisted' | 'private';
    madeForKids?: boolean;
}

export function youtubeProblem(o: YouTubeOptions): string {
    if (!o.privacyStatus) return 'Choose the YouTube visibility.';
    if (typeof o.madeForKids !== 'boolean') return 'Say whether the YouTube video is made for kids.';
    return '';
}

export function YouTubePostSettings({ value, onChange }: { value: YouTubeOptions; onChange: (v: YouTubeOptions) => void }) {
    const set = (patch: Partial<YouTubeOptions>) => onChange({ ...value, ...patch });
    return (
        <div className="tt-settings">
            <label className="field">
                <span>Visibility</span>
                <select className="input" value={value.privacyStatus || ''} onChange={(e) => set({ privacyStatus: (e.target.value || undefined) as YouTubeOptions['privacyStatus'] })} aria-label="YouTube visibility">
                    <option value="" disabled>
                        Select visibility
                    </option>
                    <option value="public">Public</option>
                    <option value="unlisted">Unlisted</option>
                    <option value="private">Private</option>
                </select>
            </label>
            <div className="field">
                <span>Is this video made for kids? (required by YouTube)</span>
                <div className="tt-checks">
                    <label>
                        <input type="radio" name="yt-mfk" checked={value.madeForKids === true} onChange={() => set({ madeForKids: true })} /> Yes, it’s made for kids
                    </label>
                    <label>
                        <input type="radio" name="yt-mfk" checked={value.madeForKids === false} onChange={() => set({ madeForKids: false })} /> No, it’s not made for kids
                    </label>
                </div>
            </div>
        </div>
    );
}

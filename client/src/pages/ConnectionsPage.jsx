import { useEffect, useState, useCallback } from 'react';
import {
    Instagram,
    Facebook,
    Youtube,
    Smartphone,
    CheckCircle2,
    AlertCircle,
    Plus,
    RefreshCw,
    Trash2,
    Loader2,
    Upload,
    MessageSquare,
    Video,
    ExternalLink,
    Megaphone,
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { apiClient } from '../lib/api';
import ConnectPermissions from '../components/connections/ConnectPermissions';
import MetaAccountPicker from '../components/connections/MetaAccountPicker';
import './Connections.css';

const PLATFORM_META = {
    // The TikTok mark is monochrome, so it follows the theme's text colour.
    instagram: { name: 'Instagram', icon: Instagram, color: '#E4405F' },
    facebook: { name: 'Facebook Page', icon: Facebook, color: '#1877F2' },
    tiktok: { name: 'TikTok', icon: Smartphone, color: 'var(--text-primary)' },
    youtube: { name: 'YouTube', icon: Youtube, color: '#FF0000' },
    meta_ads: { name: 'Meta Ads', icon: Megaphone, color: '#0866FF' },
};

// The four social platforms, plus a Meta ad account for the Ads page.
const ALL_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube', 'meta_ads'];
const REAL_OAUTH_PLATFORMS = new Set(ALL_PLATFORMS);
const COMING_SOON_PLATFORMS = new Set();

const SERVER_KEYS = {
    youtube: 'YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET',
    instagram: 'FACEBOOK_APP_ID and FACEBOOK_APP_SECRET',
    facebook: 'FACEBOOK_APP_ID and FACEBOOK_APP_SECRET',
    meta_ads: 'FACEBOOK_APP_ID and FACEBOOK_APP_SECRET',
    tiktok: 'TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET',
};

// ?reason=<code> values the OAuth callbacks redirect back with.
const REASON_MESSAGES = {
    no_channel: 'That Google account has no YouTube channel. Create a channel on YouTube first, then connect again.',
    no_instagram_business: 'No Instagram Business account was found. Your Instagram must be a Professional account linked to a Facebook Page.',
    no_page: 'No Facebook Page was found on that account. Create a Page (or ask its admin to add you), then connect again.',
    no_ad_account: 'No ad account was found on that Facebook account. Open Meta Ads Manager to create one, or ask its admin to add you, then connect again.',
    cancelled: 'The sign-in was cancelled, so nothing was connected.',
};

const FOLDERS_KEY = (workspaceId) => `kengan-client-folders-${workspaceId || 'none'}`;

function loadFolders(workspaceId) {
    try {
        const parsed = JSON.parse(localStorage.getItem(FOLDERS_KEY(workspaceId)) || '[]');
        return Array.isArray(parsed) ? parsed.filter((f) => typeof f === 'string') : [];
    } catch {
        return [];
    }
}

function normalizeConnection(raw) {
    return {
        id: raw.id || raw.platform,
        platform: raw.platform,
        username: raw.username || raw.accountName || raw.accountId || 'Connected account',
        followers:
            raw.followers ??
            raw.followersCount ??
            raw.subscriberCount ??
            0,
        status: raw.status || 'active',
        groupName: raw.groupName || '',
        connectedAt: raw.connectedAt || raw.createdAt || null,
        photoURL: raw.photoURL || raw.accountAvatar || null,
        accountName: raw.accountName || raw.username || '',
        ...raw,
    };
}

export default function ConnectionsPage() {
    const { currentWorkspace } = useWorkspace();
    const [connections, setConnections] = useState([]);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(null);
    // Connect errors are shown next to the control that started the connection.
    const [connectError, setConnectError] = useState(null); // { source, text }
    const [connectSource, setConnectSource] = useState(null);
    const [customFolders, setCustomFolders] = useState([]);
    const [youtubeVideos, setYoutubeVideos] = useState([]);
    const [youtubeComments, setYoutubeComments] = useState([]);
    const [youtubeLoading, setYoutubeLoading] = useState(false);
    const [youtubeRefreshLoading, setYoutubeRefreshLoading] = useState(false);
    const [youtubeUploadLoading, setYoutubeUploadLoading] = useState(false);
    const [youtubeMessage, setYoutubeMessage] = useState('');
    // Result of a platform sign-in: the server redirects back with ?connected=<p> or ?error=<p>.
    const [oauthNotice, setOauthNotice] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        const ok = params.get('connected');
        const failed = params.get('error');
        const reason = params.get('reason');
        const name = (id) => PLATFORM_META[id]?.name || id;
        if (ok) return { tone: 'success', text: `${name(ok)} is connected.` };
        if (failed) {
            return {
                tone: 'error',
                text: REASON_MESSAGES[reason] || `${name(failed)} could not be connected. Try again, and if it keeps failing contact support.`,
            };
        }
        return null;
    });
    // Several Pages / Instagram accounts / ad accounts were found: the server redirects back with ?select=<platform>.
    const [selectPlatform, setSelectPlatform] = useState(() => {
        const p = new URLSearchParams(window.location.search).get('select');
        return ['instagram', 'facebook', 'meta_ads'].includes(p) ? p : null;
    });
    useEffect(() => {
        if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
    }, []);
    const [youtubeUploadForm, setYoutubeUploadForm] = useState({
        videoUrl: '',
        title: '',
        description: '',
        privacyStatus: 'private',
    });

    const youtubeConnection = connections.find((connection) => connection.platform === 'youtube');

    const fetchConnections = useCallback(async () => {
        setLoading(true);
        try {
            if (!currentWorkspace?.id) {
                setConnections([]);
                return;
            }

            const data = await apiClient(`/workspaces/${currentWorkspace.id}/connections`);
            const live = (data.connections || []).map(normalizeConnection);
            setConnections(live);
        } catch (error) {
            console.warn('Connections API unavailable:', error.message);
            setConnections([]);
        } finally {
            setLoading(false);
        }
    }, [currentWorkspace?.id]);

    const loadYoutubeAssets = useCallback(async () => {
        setYoutubeLoading(true);
        setYoutubeMessage('');
        try {
            const [videosData, commentsData] = await Promise.all([
                apiClient('/connections/youtube/videos'),
                apiClient('/connections/youtube/comments'),
            ]);

            setYoutubeVideos(videosData.videos || []);
            setYoutubeComments(commentsData.comments || []);
        } catch (error) {
            console.error('Failed to load YouTube assets:', error);
            setYoutubeMessage(error.message || 'Failed to load YouTube videos and comments.');
        } finally {
            setYoutubeLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchConnections();
        setCustomFolders(loadFolders(currentWorkspace?.id));
    }, [currentWorkspace?.id, fetchConnections]);

    useEffect(() => {
        if (youtubeConnection?.id && currentWorkspace?.id) {
            loadYoutubeAssets();
        } else {
            setYoutubeVideos([]);
            setYoutubeComments([]);
        }
    }, [youtubeConnection?.id, currentWorkspace?.id, loadYoutubeAssets]);

    const updateConnectionGroup = async (connectionId, groupName) => {
        try {
            setConnections((prev) => prev.map((connection) => (
                connection.id === connectionId ? { ...connection, groupName } : connection
            )));

            if (currentWorkspace?.id) {
                await apiClient(`/workspaces/${currentWorkspace.id}/connections/${connectionId}`, {
                    method: 'PUT',
                    body: { groupName },
                });
            }
        } catch (error) {
            console.error('Failed to update group:', error);
            await fetchConnections();
        }
    };

    const handleAddFolder = () => {
        const name = (prompt('Name the client folder (e.g. the client or brand name). Move connected accounts into it with "Move to Folder".') || '').trim();
        if (name && !customFolders.includes(name)) {
            const next = [...customFolders, name];
            setCustomFolders(next);
            // Empty folders live in this browser; a folder with accounts in it is saved with those accounts.
            try {
                localStorage.setItem(FOLDERS_KEY(currentWorkspace?.id), JSON.stringify(next));
            } catch {
                /* storage unavailable: keep in memory only */
            }
        }
    };

    // Connecting first explains what the platform will be asked for (ConnectPermissions); Continue starts the sign-in.
    const [pendingConnect, setPendingConnect] = useState(null); // { platformId, source }
    const handleConnect = (platformId, source) => {
        setConnectError(null);
        setPendingConnect({ platformId, source });
    };

    const startConnect = async (platformId, source) => {
        setConnecting(platformId);
        setConnectSource(source);
        setConnectError(null);

        try {
            if (!currentWorkspace?.id) {
                throw new Error('Select a workspace before connecting a platform.');
            }

            if (COMING_SOON_PLATFORMS.has(platformId) || !REAL_OAUTH_PLATFORMS.has(platformId)) {
                throw new Error(`${PLATFORM_META[platformId]?.name || platformId} is coming soon.`);
            }

            const data = await apiClient(`/connections/${platformId}/auth-url`);
            window.location.assign(data.url);
        } catch (error) {
            console.error('Connection launch failed:', error);
            const name = PLATFORM_META[platformId]?.name || platformId;
            setConnectError({
                source,
                text: /OAUTH_NOT_CONFIGURED/.test(error.message || '')
                    ? `${name}: not set up on the server yet. An admin needs to add ${SERVER_KEYS[platformId] || 'its app keys'} to the API environment (see docs/SOCIAL_SETUP.md).`
                    : error.message || 'Could not start the connection. Try again.',
            });
            setConnecting(null);
            setPendingConnect(null);
        }
    };

    const handleDisconnect = async (connection) => {
        const name = PLATFORM_META[connection.platform]?.name || connection.platform;
        if (!window.confirm(`Disconnect ${name} (@${connection.username})? Scheduled posts and automations for this account will stop working until you reconnect.`)) {
            return;
        }
        try {
            if (currentWorkspace?.id) {
                if (connection.id === connection.platform) {
                    await apiClient(`/connections/${connection.platform}`, {
                        method: 'DELETE',
                    });
                } else {
                    await apiClient(`/workspaces/${currentWorkspace.id}/connections/${connection.id}`, {
                        method: 'DELETE',
                    });
                }
            }
            await fetchConnections();
        } catch (error) {
            console.error('Failed to disconnect platform:', error);
            setConnectError({ source: connection.groupName || 'Ungrouped', text: error.message || 'Failed to disconnect platform.' });
        }
    };

    const handleRefreshYoutube = async () => {
        setYoutubeRefreshLoading(true);
        setYoutubeMessage('');
        try {
            await apiClient('/connections/youtube/refresh', { method: 'POST' });
            await fetchConnections();
            await loadYoutubeAssets();
            setYoutubeMessage('YouTube connection refreshed.');
        } catch (error) {
            setYoutubeMessage(error.message || 'Failed to refresh YouTube token.');
        } finally {
            setYoutubeRefreshLoading(false);
        }
    };

    const handleYoutubeUpload = async (event) => {
        event.preventDefault();
        setYoutubeUploadLoading(true);
        setYoutubeMessage('');

        try {
            const payload = {
                videoUrl: youtubeUploadForm.videoUrl.trim(),
                title: youtubeUploadForm.title.trim(),
                description: youtubeUploadForm.description.trim(),
                privacyStatus: youtubeUploadForm.privacyStatus,
            };

            const data = await apiClient('/connections/youtube/upload', {
                method: 'POST',
                body: payload,
            });

            setYoutubeMessage(`Uploaded to YouTube successfully. Video ID: ${data.videoId}`);
            setYoutubeUploadForm({
                videoUrl: '',
                title: '',
                description: '',
                privacyStatus: 'private',
            });
            await loadYoutubeAssets();
        } catch (error) {
            setYoutubeMessage(error.message || 'Failed to upload to YouTube.');
        } finally {
            setYoutubeUploadLoading(false);
        }
    };

    const handleDeleteYoutubeVideo = async (videoId) => {
        if (!window.confirm('Delete this YouTube video permanently?')) {
            return;
        }

        try {
            await apiClient(`/connections/youtube/videos/${videoId}`, {
                method: 'DELETE',
            });
            setYoutubeVideos((prev) => prev.filter((video) => video.id !== videoId));
            setYoutubeComments((prev) => prev.filter((comment) => comment.videoId !== videoId));
            setYoutubeMessage('Video deleted from YouTube.');
        } catch (error) {
            setYoutubeMessage(error.message || 'Failed to delete YouTube video.');
        }
    };

    const allFolders = Array.from(new Set([
        ...customFolders,
        ...connections.map((connection) => connection.groupName).filter(Boolean),
    ]));
    const grouped = { Ungrouped: [] };
    allFolders.forEach((folder) => {
        grouped[folder] = [];
    });

    connections.forEach((connection) => {
        const group = connection.groupName || 'Ungrouped';
        if (!grouped[group]) {
            grouped[group] = [];
        }
        grouped[group].push(connection);
    });

    const groupsToRender = allFolders.map((folder) => [folder, grouped[folder]]);
    groupsToRender.push(['Ungrouped', grouped.Ungrouped]);

    return (
        <div className="connections-page animate-fade-in">
            <div className="page-header">
                <div>
                    <h1>Social Connections</h1>
                    <p className="page-subtitle">Manage your linked social media accounts and pages.</p>
                    {oauthNotice ? (
                        <div className={oauthNotice.tone === 'error' ? 'error-banner' : 'success-banner'} role="status" style={{ marginTop: 12 }}>
                            {oauthNotice.text}{' '}
                            <button className="btn-icon btn-sm" onClick={() => setOauthNotice(null)} aria-label="Dismiss">×</button>
                        </div>
                    ) : null}
                </div>
                <div>
                    <button className="btn btn-secondary" style={{ marginRight: '12px' }} onClick={handleAddFolder}>
                        <Plus size={18} /> New Client Folder
                    </button>
                    <button className="btn btn-primary" onClick={() => document.getElementById('add-connection-select-Ungrouped')?.focus()}>
                        <Plus size={18} /> Add General Platform
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="card" style={{ padding: '60px', textAlign: 'center' }}>
                    <Loader2 size={32} className="spin" style={{ color: 'var(--accent-primary)', margin: '0 auto' }} />
                    <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>Loading connections...</p>
                </div>
            ) : (
                <>
                    <div className="page-header">
                        <h3 style={{ marginTop: '32px' }}>Workspace Folders</h3>
                    </div>

                    {groupsToRender.map(([group, groupConnections]) => (
                        <div
                            key={group}
                            className="connection-group-section"
                            style={{
                                marginBottom: '48px',
                                background: 'var(--bg-secondary)',
                                padding: '24px',
                                borderRadius: '12px',
                                border: '1px solid var(--border-color)',
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                                <h4 style={{
                                    color: 'var(--text-primary)',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.05em',
                                    fontSize: '15px',
                                }}>
                                    {group === 'Ungrouped' ? 'General / Ungrouped' : `Client: ${group}`}
                                </h4>
                                <span className="text-muted text-sm">{groupConnections.length} accounts</span>
                            </div>

                            <div className="connections-grid stagger-children">
                                {groupConnections.map((connection) => {
                                    const meta = PLATFORM_META[connection.platform] || PLATFORM_META.instagram;
                                    const Icon = meta.icon;

                                    return (
                                        <div key={connection.id} className="connection-card card connection-card--connected">
                                            <div className="connection-card__header">
                                                <div
                                                    className="platform-icon"
                                                    style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 9%, transparent)`, color: meta.color }}
                                                >
                                                    <Icon size={24} />
                                                </div>
                                                <div className="connection-card__actions">
                                                    <button className="btn-icon btn-ghost" onClick={() => handleDisconnect(connection)} title="Disconnect">
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="connection-card__body">
                                                <h3>{meta.name}</h3>
                                                <p className="username">{connection.platform === 'meta_ads' ? connection.username : `@${connection.username}`}</p>
                                                {Number(connection.followers) > 0 && (
                                                    <p className="followers-count">{Number(connection.followers).toLocaleString()} followers</p>
                                                )}
                                                <div className={`status-badge ${connection.status}`}>
                                                    {connection.status === 'active' ? (
                                                        <><CheckCircle2 size={12} /> Active</>
                                                    ) : (
                                                        <><AlertCircle size={12} /> Expired</>
                                                    )}
                                                </div>

                                                <div style={{ marginTop: '12px' }}>
                                                    <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                                                        Move to Folder
                                                    </label>
                                                    <select
                                                        className="input input-sm"
                                                        value={connection.groupName || ''}
                                                        onChange={(event) => updateConnectionGroup(connection.id, event.target.value)}
                                                        style={{ width: '100%', border: '1px solid var(--border-color)', background: 'var(--bg-primary)' }}
                                                    >
                                                        <option value="">General / Ungrouped</option>
                                                        {allFolders.map((folder) => (
                                                            <option key={folder} value={folder}>{folder}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}

                                <div
                                    className="connection-card card"
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        minHeight: '260px',
                                        borderStyle: 'dashed',
                                        background: 'transparent',
                                    }}
                                >
                                    <div className="platform-icon" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                                        <Plus size={24} />
                                    </div>
                                    <h4 style={{ marginBottom: '16px', fontSize: '14px' }}>
                                        Add Account to {group === 'Ungrouped' ? 'General' : group}
                                    </h4>
                                    <select
                                        id={`add-connection-select-${group}`}
                                        className="input mb-sm"
                                        style={{ width: '80%' }}
                                        disabled={!!connecting}
                                        onChange={(event) => {
                                            if (event.target.value) {
                                                handleConnect(event.target.value, group);
                                                event.target.value = '';
                                            }
                                        }}
                                    >
                                        <option value="">Select Platform...</option>
                                        {ALL_PLATFORMS.map((platform) => (
                                            <option key={platform} value={platform} disabled={COMING_SOON_PLATFORMS.has(platform)}>
                                                {PLATFORM_META[platform].name}{COMING_SOON_PLATFORMS.has(platform) ? ' (coming soon)' : ''}
                                            </option>
                                        ))}
                                    </select>
                                    {connecting && connectSource === group && (
                                        <p className="connect-inline-status">
                                            <Loader2 size={14} className="spin" /> Opening {PLATFORM_META[connecting]?.name || connecting} sign-in…
                                        </p>
                                    )}
                                    {connectError?.source === group && (
                                        <p className="connect-inline-error" role="alert">{connectError.text}</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}

                    <section className="card youtube-studio">
                        <div className="youtube-studio__header">
                            <div>
                                <h3>YouTube Studio</h3>
                                <p className="page-subtitle">
                                    Connect a Google account, pull channel videos and comments, upload by URL, and delete videos.
                                </p>
                            </div>
                            <div className="youtube-studio__actions">
                                {!youtubeConnection ? (
                                    <button
                                        className="btn btn-primary"
                                        onClick={() => handleConnect('youtube', 'youtube-studio')}
                                        disabled={connecting === 'youtube'}
                                    >
                                        {connecting === 'youtube' ? <Loader2 size={16} className="spin" /> : <Youtube size={16} />}
                                        Connect YouTube
                                    </button>
                                ) : (
                                    <>
                                        <button className="btn btn-secondary" onClick={handleRefreshYoutube} disabled={youtubeRefreshLoading}>
                                            {youtubeRefreshLoading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                                            Refresh Token
                                        </button>
                                        <button className="btn btn-secondary" onClick={loadYoutubeAssets} disabled={youtubeLoading}>
                                            {youtubeLoading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                                            Reload Data
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {connectError?.source === 'youtube-studio' ? (
                            <div className="connect-inline-error" role="alert">{connectError.text}</div>
                        ) : null}
                        {youtubeMessage ? (
                            <div className="youtube-studio__message">{youtubeMessage}</div>
                        ) : null}

                        {!youtubeConnection ? (
                            <div className="youtube-studio__empty">
                                <Youtube size={28} />
                                <div>
                                    <h4>YouTube is not connected yet</h4>
                                    <p>Use Google OAuth to grant upload, video read, and comment read access for this workspace.</p>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="youtube-studio__summary">
                                    <div className="youtube-metric card">
                                        <Video size={18} />
                                        <div>
                                            <strong>{youtubeVideos.length}</strong>
                                            <span>Videos loaded</span>
                                        </div>
                                    </div>
                                    <div className="youtube-metric card">
                                        <MessageSquare size={18} />
                                        <div>
                                            <strong>{youtubeComments.length}</strong>
                                            <span>Comments loaded</span>
                                        </div>
                                    </div>
                                    <div className="youtube-metric card">
                                        <CheckCircle2 size={18} />
                                        <div>
                                            <strong>{youtubeConnection.accountName || youtubeConnection.username}</strong>
                                            <span>Connected channel</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="youtube-studio__layout">
                                    <form className="card youtube-upload-card" onSubmit={handleYoutubeUpload}>
                                        <div className="youtube-upload-card__header">
                                            <h4>Upload to YouTube</h4>
                                            <Upload size={18} />
                                        </div>
                                        <label>
                                            Public video URL
                                            <input
                                                className="input"
                                                value={youtubeUploadForm.videoUrl}
                                                onChange={(event) => setYoutubeUploadForm((prev) => ({ ...prev, videoUrl: event.target.value }))}
                                                placeholder="https://..."
                                                required
                                            />
                                        </label>
                                        <label>
                                            Title
                                            <input
                                                className="input"
                                                value={youtubeUploadForm.title}
                                                onChange={(event) => setYoutubeUploadForm((prev) => ({ ...prev, title: event.target.value }))}
                                                placeholder="Video title"
                                                required
                                            />
                                        </label>
                                        <label>
                                            Description
                                            <textarea
                                                className="input"
                                                rows={5}
                                                value={youtubeUploadForm.description}
                                                onChange={(event) => setYoutubeUploadForm((prev) => ({ ...prev, description: event.target.value }))}
                                                placeholder="Description"
                                            />
                                        </label>
                                        <label>
                                            Privacy
                                            <select
                                                className="input"
                                                value={youtubeUploadForm.privacyStatus}
                                                onChange={(event) => setYoutubeUploadForm((prev) => ({ ...prev, privacyStatus: event.target.value }))}
                                            >
                                                <option value="private">Private</option>
                                                <option value="unlisted">Unlisted</option>
                                                <option value="public">Public</option>
                                            </select>
                                        </label>
                                        <button className="btn btn-primary full-width" type="submit" disabled={youtubeUploadLoading}>
                                            {youtubeUploadLoading ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
                                            Upload Video
                                        </button>
                                    </form>

                                    <div className="youtube-list-panel">
                                        <div className="youtube-list-panel__section card">
                                            <div className="youtube-list-panel__header">
                                                <h4>Recent Videos</h4>
                                                <span>{youtubeVideos.length}</span>
                                            </div>
                                            <div className="youtube-list">
                                                {youtubeVideos.length === 0 ? (
                                                    <p className="not-connected">No videos returned yet.</p>
                                                ) : youtubeVideos.map((video) => (
                                                    <div key={video.id} className="youtube-list-item">
                                                        <div className="youtube-list-item__content">
                                                            {video.thumbnailUrl ? (
                                                                <img src={video.thumbnailUrl} alt={video.title} className="youtube-thumb" />
                                                            ) : null}
                                                            <div>
                                                                <strong>{video.title}</strong>
                                                                <p>{video.viewCount.toLocaleString()} views • {video.commentCount.toLocaleString()} comments</p>
                                                                <p>{video.privacyStatus}</p>
                                                            </div>
                                                        </div>
                                                        <div className="youtube-list-item__actions">
                                                            <a
                                                                className="btn btn-ghost"
                                                                href={`https://www.youtube.com/watch?v=${video.id}`}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                            >
                                                                <ExternalLink size={14} />
                                                            </a>
                                                            <button className="btn btn-ghost" onClick={() => handleDeleteYoutubeVideo(video.id)}>
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="youtube-list-panel__section card">
                                            <div className="youtube-list-panel__header">
                                                <h4>Recent Comments</h4>
                                                <span>{youtubeComments.length}</span>
                                            </div>
                                            <div className="youtube-list">
                                                {youtubeComments.length === 0 ? (
                                                    <p className="not-connected">No comments returned yet.</p>
                                                ) : youtubeComments.map((comment) => (
                                                    <div key={comment.id} className="youtube-comment-item">
                                                        <strong>{comment.authorDisplayName}</strong>
                                                        <p>{comment.textDisplay}</p>
                                                        <span>Likes: {comment.likeCount} • Video: {comment.videoId || 'channel'}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </section>
                </>
            )}

            <section className="connection-info card glass">
                <AlertCircle size={24} className="text-info" />
                <div>
                    <h4>Connection Security</h4>
                    <p>KenganSocial uses official OAuth APIs to connect to your accounts. We never see your passwords, and we only ask for the permissions the features you use need. Before each sign-in we explain what will be asked for and why.</p>
                </div>
            </section>

            {selectPlatform && (
                <MetaAccountPicker
                    platform={selectPlatform}
                    onCancel={() => setSelectPlatform(null)}
                    onDone={(name) => {
                        setOauthNotice({ tone: 'success', text: `${PLATFORM_META[selectPlatform].name}${name ? ` (${name})` : ''} is connected.` });
                        setSelectPlatform(null);
                        fetchConnections();
                    }}
                />
            )}

            {pendingConnect && (
                <ConnectPermissions
                    platform={pendingConnect.platformId}
                    busy={connecting === pendingConnect.platformId}
                    onCancel={() => setPendingConnect(null)}
                    onContinue={() => startConnect(pendingConnect.platformId, pendingConnect.source)}
                />
            )}
        </div>
    );
}

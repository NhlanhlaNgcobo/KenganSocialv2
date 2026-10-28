import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import {
    User,
    Settings2,
    Shield,
    Users,
    Key,
    Save,
    Plus,
    Trash2,
    Loader2,
    Check,
    Copy,
    AlertCircle,
    ExternalLink,
    Palette,
    Sun,
    Moon,
    Monitor
} from 'lucide-react';
import { apiClient } from '../lib/api';
import { auth } from '../lib/firebase';
import DeleteAccount from '../components/settings/DeleteAccount';
import PrivacyDataSection from '../components/settings/PrivacyDataSection';
import { useWorkspace } from '../context/WorkspaceContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import './Settings.css';
import { confirmDialog } from '../lib/dialogs';

/** Resizes an image file to a square JPEG data URL small enough to store on the profile. */
function resizeToAvatar(file, size = 256) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const side = Math.min(img.naturalWidth, img.naturalHeight);
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            canvas.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('That file is not an image we can read.'));
        };
        img.src = url;
    });
}

function Banner({ msg }) {
    if (!msg?.text) return null;
    const isError = msg.type === 'error';
    return (
        <div className={isError ? 'error-banner' : 'success-banner'} role={isError ? 'alert' : 'status'}>
            {isError ? <AlertCircle size={16} /> : <Check size={16} />}
            <span>{msg.text}</span>
        </div>
    );
}

const THEME_OPTIONS = [
    { id: 'light', name: 'Light', description: 'Bright surfaces with dark text.', icon: Sun },
    { id: 'dark', name: 'Dark', description: 'Dark surfaces, easier on the eyes at night.', icon: Moon },
    { id: 'system', name: 'System', description: 'Match your device setting automatically.', icon: Monitor },
];

const MIN_PASSWORD_LENGTH = 8;
const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', editor: 'Editor', viewer: 'Viewer' };

const TABS = [
    { id: 'profile', name: 'Profile', icon: User },
    { id: 'appearance', name: 'Appearance', icon: Palette },
    { id: 'workspace', name: 'Workspace', icon: Settings2 },
    { id: 'team', name: 'Team', icon: Users },
    { id: 'security', name: 'Security', icon: Shield },
];

export default function SettingsPage() {
    const [activeTab, setActiveTab] = useState('profile');
    const { preference, setPreference, theme } = useTheme();

    // Profile State
    const [loadingProfile, setLoadingProfile] = useState(true);
    const [savingProfile, setSavingProfile] = useState(false);
    const [profileData, setProfileData] = useState({ fullName: '', email: '', bio: '', photoURL: null });
    const [profileMsg, setProfileMsg] = useState({ type: '', text: '' });
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const photoInputRef = useRef(null);

    const { refreshProfile, workspace: ownWorkspace, plan: ownPlan } = useAuth();

    // Workspace state
    const { currentWorkspace, fetchWorkspaces } = useWorkspace();
    const [workspaceName, setWorkspaceName] = useState('');
    const [savingWorkspace, setSavingWorkspace] = useState(false);
    const [workspaceMsg, setWorkspaceMsg] = useState({ type: '', text: '' });
    const [copiedId, setCopiedId] = useState(false);
    const workspaceRole = currentWorkspace?.role || null;
    const canRenameWorkspace = workspaceRole === 'owner' || workspaceRole === 'admin';
    // The session plan includes the development plan override, so prefer it for the user's own workspace.
    const workspacePlan = currentWorkspace?.id && currentWorkspace.id === ownWorkspace?.id ? ownPlan : (currentWorkspace?.plan || 'starter');

    // Team state
    const [members, setMembers] = useState([]);
    const [yourRole, setYourRole] = useState(null);
    const [loadingTeam, setLoadingTeam] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState('editor');
    const [inviting, setInviting] = useState(false);
    const [removingId, setRemovingId] = useState(null);
    const [teamMsg, setTeamMsg] = useState({ type: '', text: '' });

    // Security state
    const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
    const [savingPassword, setSavingPassword] = useState(false);
    const [securityMsg, setSecurityMsg] = useState({ type: '', text: '' });
    const hasPasswordLogin = !!auth?.currentUser?.providerData?.some((p) => p.providerId === 'password');

    useEffect(() => {
        if (activeTab === 'profile') {
            fetchProfile();
        }
        if (activeTab === 'team' && currentWorkspace?.id) {
            fetchMembers();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, currentWorkspace?.id]);

    useEffect(() => {
        setWorkspaceName(currentWorkspace?.name || '');
        setWorkspaceMsg({ type: '', text: '' });
    }, [currentWorkspace?.id, currentWorkspace?.name]);

    const trimmedWorkspaceName = workspaceName.trim();
    const workspaceNameValid = trimmedWorkspaceName.length >= 3 && trimmedWorkspaceName.length <= 50;
    const workspaceNameChanged = trimmedWorkspaceName !== (currentWorkspace?.name || '');

    const handleRenameWorkspace = async (e) => {
        e.preventDefault();
        setWorkspaceMsg({ type: '', text: '' });
        if (!workspaceNameValid) {
            return setWorkspaceMsg({ type: 'error', text: 'Workspace names are 3–50 characters.' });
        }
        setSavingWorkspace(true);
        try {
            await apiClient(`/workspaces/${currentWorkspace.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ name: trimmedWorkspaceName }),
            });
            // Refresh the switcher list and the signed-in session so every view shows the new name.
            await Promise.allSettled([fetchWorkspaces(), refreshProfile()]);
            setWorkspaceMsg({ type: 'success', text: 'Workspace renamed.' });
        } catch (error) {
            setWorkspaceMsg({ type: 'error', text: error.message || 'Could not rename the workspace. Try again.' });
        } finally {
            setSavingWorkspace(false);
        }
    };

    const handleCopyWorkspaceId = async () => {
        try {
            await navigator.clipboard.writeText(currentWorkspace.id);
            setCopiedId(true);
            setTimeout(() => setCopiedId(false), 2000);
        } catch {
            setWorkspaceMsg({ type: 'error', text: 'Could not copy automatically. Select the ID and copy it instead.' });
        }
    };

    const handlePhotoSelected = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setUploadingPhoto(true);
        setProfileMsg({ type: '', text: '' });
        try {
            const photoURL = await resizeToAvatar(file);
            await apiClient('/auth/profile', { method: 'PUT', body: JSON.stringify({ photoURL }) });
            setProfileData((p) => ({ ...p, photoURL }));
            setProfileMsg({ type: 'success', text: 'Photo updated.' });
            // Update the sidebar avatar and anything else reading the signed-in profile.
            refreshProfile().catch(() => {});
        } catch (error) {
            setProfileMsg({ type: 'error', text: error.message || 'Could not update the photo. Try again.' });
        } finally {
            setUploadingPhoto(false);
        }
    };

    const fetchMembers = async () => {
        setLoadingTeam(true);
        try {
            const data = await apiClient(`/workspaces/${currentWorkspace.id}/members`);
            setMembers(data.members || []);
            setYourRole(data.yourRole || null);
        } catch (error) {
            setTeamMsg({ type: 'error', text: error.message || 'Could not load the team. Try again.' });
        } finally {
            setLoadingTeam(false);
        }
    };

    const handleInvite = async (e) => {
        e.preventDefault();
        setInviting(true);
        setTeamMsg({ type: '', text: '' });
        try {
            const data = await apiClient(`/workspaces/${currentWorkspace.id}/members`, {
                method: 'POST',
                body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
            });
            setMembers((m) => [...m.filter((x) => x.uid !== data.member.uid), data.member]);
            setInviteEmail('');
            setTeamMsg({ type: 'success', text: `${data.member.name} now has ${data.member.role} access.` });
        } catch (error) {
            setTeamMsg({ type: 'error', text: error.message || 'Could not add that member. Try again.' });
        } finally {
            setInviting(false);
        }
    };

    const handleRemove = async (member) => {
        if (!(await confirmDialog(`Remove ${member.name} from this workspace?`, { confirmLabel: 'Remove', danger: true }))) return;
        setRemovingId(member.uid);
        setTeamMsg({ type: '', text: '' });
        try {
            await apiClient(`/workspaces/${currentWorkspace.id}/members/${member.uid}`, { method: 'DELETE' });
            setMembers((m) => m.filter((x) => x.uid !== member.uid));
            setTeamMsg({ type: 'success', text: `${member.name} was removed.` });
        } catch (error) {
            setTeamMsg({ type: 'error', text: error.message || 'Could not remove that member. Try again.' });
        } finally {
            setRemovingId(null);
        }
    };

    const handleUpdatePassword = async () => {
        setSecurityMsg({ type: '', text: '' });
        if (passwords.next.length < MIN_PASSWORD_LENGTH) return setSecurityMsg({ type: 'error', text: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.` });
        if (passwords.next !== passwords.confirm) return setSecurityMsg({ type: 'error', text: 'The new passwords do not match.' });
        const user = auth?.currentUser;
        if (!user?.email) return setSecurityMsg({ type: 'error', text: 'You need to be signed in to change your password.' });

        setSavingPassword(true);
        try {
            await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, passwords.current));
            await updatePassword(user, passwords.next);
            setPasswords({ current: '', next: '', confirm: '' });
            setSecurityMsg({ type: 'success', text: 'Password updated.' });
        } catch (error) {
            const code = error?.code || '';
            const text = code.includes('wrong-password') || code.includes('invalid-credential')
                ? 'Your current password is incorrect.'
                : code.includes('too-many-requests')
                    ? 'Too many attempts. Wait a few minutes and try again.'
                    : code.includes('weak-password')
                        ? 'That password is too weak. Use a longer one.'
                        : code.includes('requires-recent-login')
                            ? 'For your security, sign out and back in, then change your password.'
                            : 'Could not update your password. Try again.';
            setSecurityMsg({ type: 'error', text });
        } finally {
            setSavingPassword(false);
        }
    };

    const fetchProfile = async () => {
        setLoadingProfile(true);
        try {
            const data = await apiClient('/auth/me');
            setProfileData({
                fullName: data.user?.displayName || '',
                email: data.user?.email || '',
                bio: data.user?.bio || '',
                photoURL: data.user?.photoURL || null,
            });
        } catch (error) {
            console.error('Failed to load profile', error);
            setProfileMsg({ type: 'error', text: error.message || 'Could not load your profile. Refresh the page to try again.' });
        } finally {
            setLoadingProfile(false);
        }
    };

    const handleSaveProfile = async () => {
        setProfileMsg({ type: '', text: '' });
        if (!profileData.fullName.trim()) {
            return setProfileMsg({ type: 'error', text: 'Add your name.' });
        }
        setSavingProfile(true);
        try {
            await apiClient('/auth/profile', {
                method: 'PUT',
                body: JSON.stringify({
                    displayName: profileData.fullName,
                    bio: profileData.bio,
                })
            });
            setProfileMsg({ type: 'success', text: 'Profile saved.' });
            setTimeout(() => setProfileMsg({ type: '', text: '' }), 3000);
            // Update the sidebar name and anything else reading the signed-in profile.
            refreshProfile().catch(() => {});
        } catch (error) {
            setProfileMsg({ type: 'error', text: error.message || 'Could not save your profile. Try again.' });
        } finally {
            setSavingProfile(false);
        }
    };

    return (
        <div className="settings-page animate-fade-in">
            <div className="page-header">
                <div>
                    <h1>Account Settings</h1>
                    <p className="page-subtitle">Manage your personal profile and workspace preferences.</p>
                </div>
            </div>

            <div className="settings-layout">
                <aside className="settings-nav">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            className={`settings-nav-item ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            <tab.icon size={18} />
                            <span>{tab.name}</span>
                        </button>
                    ))}

                    {/* Footer link to Legal page */}
                    <div style={{ marginTop: 'auto', paddingTop: '20px', borderTop: '1px solid var(--border-color)' }}>
                        <Link
                            to="/terms"
                            className="settings-nav-item"
                            style={{ fontSize: '0.82rem', opacity: 0.65, textDecoration: 'none' }}
                        >
                            <ExternalLink size={14} />
                            <span>Legal &amp; Terms</span>
                        </Link>
                    </div>
                </aside>

                <main className="settings-content animate-slide-in">
                    {activeTab === 'profile' && (
                        <div className="settings-section card">
                            <h3>Profile Information</h3>
                            <Banner msg={profileMsg} />
                            <div className="profile-upload">
                                <div
                                    className="avatar-preview"
                                    style={profileData.photoURL ? { backgroundImage: `url(${profileData.photoURL})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                                />
                                <button className="btn btn-secondary btn-sm" onClick={() => photoInputRef.current?.click()} disabled={uploadingPhoto}>
                                    {uploadingPhoto ? <><Loader2 size={14} className="spin" /> Uploading...</> : 'Change Photo'}
                                </button>
                                <input ref={photoInputRef} type="file" accept="image/*" hidden onChange={handlePhotoSelected} />
                            </div>

                            {loadingProfile ? (
                                <div className="flex justify-center p-xl">
                                    <Loader2 size={24} className="spin text-brand" />
                                </div>
                            ) : (
                                <div className="form-grid">
                                    <div className="input-group">
                                        <label>Full Name</label>
                                        <input
                                            type="text"
                                            className="input"
                                            value={profileData.fullName}
                                            onChange={e => setProfileData({ ...profileData, fullName: e.target.value })}
                                        />
                                    </div>
                                    <div className="input-group">
                                        <label>Email Address</label>
                                        <input
                                            type="email"
                                            className="input"
                                            value={profileData.email}
                                            disabled
                                            title="Email cannot be changed here"
                                        />
                                    </div>
                                    <div className="input-group full-width">
                                        <label>Bio</label>
                                        <textarea
                                            className="input"
                                            value={profileData.bio}
                                            onChange={e => setProfileData({ ...profileData, bio: e.target.value })}
                                            placeholder="Tell us about yourself..."
                                        />
                                    </div>
                                </div>
                            )}
                            <div className="section-footer">
                                <button
                                    className="btn btn-primary"
                                    onClick={handleSaveProfile}
                                    disabled={savingProfile || loadingProfile}
                                >
                                    {savingProfile
                                        ? <><Loader2 size={18} className="spin" /> Saving...</>
                                        : <><Save size={18} /> Save Changes</>
                                    }
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'appearance' && (
                        <div className="settings-section card">
                            <h3>Appearance</h3>
                            <p className="appearance-intro">
                                Choose how KenganSocial looks. System follows your device and is currently using {theme} mode.
                            </p>
                            <div className="theme-options" role="radiogroup" aria-label="Theme">
                                {THEME_OPTIONS.map((option) => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        role="radio"
                                        aria-checked={preference === option.id}
                                        className={`theme-option ${preference === option.id ? 'active' : ''}`}
                                        onClick={() => setPreference(option.id)}
                                    >
                                        <span className={`theme-option__preview theme-option__preview--${option.id}`} aria-hidden="true">
                                            <span className="theme-option__preview-bar" />
                                            <span className="theme-option__preview-line" />
                                            <span className="theme-option__preview-line theme-option__preview-line--short" />
                                        </span>
                                        <span className="theme-option__label">
                                            <option.icon size={16} />
                                            {option.name}
                                            {preference === option.id && <Check size={14} className="theme-option__check" />}
                                        </span>
                                        <span className="theme-option__desc">{option.description}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {activeTab === 'workspace' && (
                        <div className="settings-section card">
                            <h3>Workspace Settings</h3>
                            <Banner msg={workspaceMsg} />
                            {!currentWorkspace ? (
                                <p className="settings-muted">No workspace is selected. Refresh the page to load your workspaces.</p>
                            ) : (
                                <>
                                    <form className="form-grid" onSubmit={handleRenameWorkspace}>
                                        <div className="input-group full-width">
                                            <label htmlFor="workspace-name">Workspace name</label>
                                            <input
                                                id="workspace-name"
                                                type="text"
                                                className="input"
                                                value={workspaceName}
                                                maxLength={50}
                                                onChange={(e) => setWorkspaceName(e.target.value)}
                                                disabled={!canRenameWorkspace || savingWorkspace}
                                                aria-describedby="workspace-name-hint"
                                            />
                                            <small id="workspace-name-hint" className="settings-hint">
                                                {canRenameWorkspace
                                                    ? '3–50 characters. Everyone in the workspace sees this name.'
                                                    : 'Only the workspace owner or an admin can rename it.'}
                                            </small>
                                        </div>
                                        {canRenameWorkspace ? (
                                            <div className="section-footer full-width">
                                                <button
                                                    type="submit"
                                                    className="btn btn-primary"
                                                    disabled={savingWorkspace || !workspaceNameChanged || !workspaceNameValid}
                                                >
                                                    {savingWorkspace
                                                        ? <><Loader2 size={18} className="spin" /> Saving...</>
                                                        : <><Save size={18} /> Save Name</>
                                                    }
                                                </button>
                                            </div>
                                        ) : null}
                                    </form>

                                    <dl className="workspace-details">
                                        <div>
                                            <dt>Your role</dt>
                                            <dd><span className="badge badge-info">{ROLE_LABELS[workspaceRole] || 'Member'}</span></dd>
                                        </div>
                                        <div>
                                            <dt>Plan</dt>
                                            <dd className="workspace-details__plan">
                                                {workspacePlan}
                                                {workspaceRole === 'owner' ? <Link to="/dashboard/billing">Manage plan</Link> : null}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt>Workspace ID</dt>
                                            <dd className="workspace-details__id">
                                                <code>{currentWorkspace.id}</code>
                                                <button
                                                    type="button"
                                                    className="btn btn-ghost btn-sm"
                                                    onClick={handleCopyWorkspaceId}
                                                    aria-label="Copy workspace ID"
                                                >
                                                    {copiedId ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
                                                </button>
                                            </dd>
                                        </div>
                                    </dl>
                                </>
                            )}
                        </div>
                    )}

                    {activeTab === 'team' && (
                        <div className="settings-section card">
                            <div className="flex justify-between items-center mb-lg">
                                <h3>Team Members</h3>
                            </div>
                            <Banner msg={teamMsg} />
                            {!currentWorkspace ? (
                                <p className="settings-muted">No workspace is selected. Refresh the page to load your workspaces.</p>
                            ) : null}

                            {yourRole === 'owner' ? (
                                <form className="flex gap-md mb-lg" onSubmit={handleInvite} style={{ flexWrap: 'wrap' }}>
                                    <input
                                        type="email"
                                        className="input"
                                        style={{ flex: '1 1 220px' }}
                                        placeholder="teammate@example.com"
                                        value={inviteEmail}
                                        onChange={(e) => setInviteEmail(e.target.value)}
                                        required
                                    />
                                    <select className="input" style={{ flex: '0 0 130px' }} value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                                        <option value="admin">Admin</option>
                                        <option value="editor">Editor</option>
                                        <option value="viewer">Viewer</option>
                                    </select>
                                    <button type="submit" className="btn btn-primary btn-sm" disabled={inviting || !inviteEmail}>
                                        {inviting ? <Loader2 size={16} className="spin" /> : <Plus size={16} />} Add Member
                                    </button>
                                    <p style={{ flexBasis: '100%', margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                        Teammates need a KenganSocial account first; add them by the email they signed up with.
                                    </p>
                                </form>
                            ) : yourRole ? (
                                <p className="settings-muted mb-lg">
                                    You are {yourRole === 'admin' ? 'an' : 'a'} {(ROLE_LABELS[yourRole] || 'member').toLowerCase()} in this workspace. Only the workspace owner can add or remove members.
                                </p>
                            ) : null}

                            {loadingTeam ? (
                                <div className="flex justify-center p-xl"><Loader2 size={24} className="spin text-brand" /></div>
                            ) : (
                                <div className="team-list">
                                    {members.map(member => (
                                        <div key={member.uid} className="team-item glass p-md mb-md flex items-center gap-md">
                                            <div
                                                className="member-avatar"
                                                style={member.photoURL ? { backgroundImage: `url(${member.photoURL})`, backgroundSize: 'cover' } : undefined}
                                            />
                                            <div className="member-info flex-1">
                                                <span className="member-name">{member.name}</span>
                                                <span className="member-email">{member.email}</span>
                                            </div>
                                            <span className="badge badge-info">{ROLE_LABELS[member.role] || member.role}</span>
                                            {yourRole === 'owner' && member.role !== 'owner' ? (
                                                <button
                                                    type="button"
                                                    className="btn-icon btn-ghost text-error"
                                                    title={`Remove ${member.name}`}
                                                    aria-label={`Remove ${member.name}`}
                                                    onClick={() => handleRemove(member)}
                                                    disabled={removingId === member.uid}
                                                >
                                                    {removingId === member.uid ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />}
                                                </button>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'security' && (
                        <div className="settings-section card">
                            <h3>Security Settings</h3>
                            <Banner msg={securityMsg} />
                            {hasPasswordLogin ? (
                                <>
                                    <div className="form-grid">
                                        <div className="input-group full-width">
                                            <label>Current Password</label>
                                            <input type="password" className="input" placeholder="••••••••" autoComplete="current-password"
                                                value={passwords.current} onChange={(e) => setPasswords({ ...passwords, current: e.target.value })} />
                                        </div>
                                        <div className="input-group">
                                            <label>New Password</label>
                                            <input type="password" className="input" placeholder="••••••••" autoComplete="new-password" aria-describedby="new-password-hint"
                                                value={passwords.next} onChange={(e) => setPasswords({ ...passwords, next: e.target.value })} />
                                            <small id="new-password-hint" className="settings-hint">At least {MIN_PASSWORD_LENGTH} characters.</small>
                                        </div>
                                        <div className="input-group">
                                            <label>Confirm New Password</label>
                                            <input type="password" className="input" placeholder="••••••••" autoComplete="new-password"
                                                value={passwords.confirm} onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} />
                                        </div>
                                    </div>
                                    <div className="section-footer">
                                        <button className="btn btn-primary" onClick={handleUpdatePassword}
                                            disabled={savingPassword || !passwords.current || !passwords.next || !passwords.confirm}>
                                            {savingPassword ? <Loader2 size={18} className="spin" /> : <Key size={18} />} Update Password
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <p style={{ color: 'var(--text-secondary)' }}>
                                    You sign in with Google, so there is no KenganSocial password to change. Manage your password and two-step verification in your Google account.
                                </p>
                            )}
                        </div>
                    )}

                    {activeTab === 'security' && <PrivacyDataSection />}
                    {activeTab === 'security' && <DeleteAccount ownsWorkspace={!!ownWorkspace} />}
                </main>
            </div>
        </div>
    );
}

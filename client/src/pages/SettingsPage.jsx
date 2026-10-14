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
    AlertCircle,
    ExternalLink
} from 'lucide-react';
import { apiClient } from '../lib/api';
import { auth } from '../lib/firebase';
import { useWorkspace } from '../context/WorkspaceContext';
import './Settings.css';

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
        <div
            className="alert-banner mb-md"
            style={{
                display: 'flex', gap: '8px', padding: '12px', borderRadius: '8px', alignItems: 'center',
                background: isError ? 'var(--error-bg, #ffebee)' : 'var(--success-bg, #e8f5e9)',
                color: isError ? 'var(--error, #d32f2f)' : 'var(--success, #2e7d32)',
            }}
        >
            {isError ? <AlertCircle size={16} /> : <Check size={16} />}
            <span>{msg.text}</span>
        </div>
    );
}

const TABS = [
    { id: 'profile', name: 'Profile', icon: User },
    { id: 'workspace', name: 'Workspace', icon: Settings2 },
    { id: 'team', name: 'Team', icon: Users },
    { id: 'security', name: 'Security', icon: Shield },
];

export default function SettingsPage() {
    const [activeTab, setActiveTab] = useState('profile');

    // Profile State
    const [loadingProfile, setLoadingProfile] = useState(true);
    const [savingProfile, setSavingProfile] = useState(false);
    const [profileData, setProfileData] = useState({ fullName: '', email: '', bio: '', photoURL: null });
    const [profileMsg, setProfileMsg] = useState({ type: '', text: '' });
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const photoInputRef = useRef(null);

    // Team state
    const { currentWorkspace } = useWorkspace();
    const [members, setMembers] = useState([]);
    const [yourRole, setYourRole] = useState(null);
    const [loadingTeam, setLoadingTeam] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState('editor');
    const [inviting, setInviting] = useState(false);
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
        } catch (error) {
            setProfileMsg({ type: 'error', text: error.message || 'Could not update photo' });
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
            setTeamMsg({ type: 'error', text: error.message || 'Failed to load team' });
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
            setTeamMsg({ type: 'error', text: error.message || 'Could not add member' });
        } finally {
            setInviting(false);
        }
    };

    const handleRemove = async (member) => {
        if (!window.confirm(`Remove ${member.name} from this workspace?`)) return;
        try {
            await apiClient(`/workspaces/${currentWorkspace.id}/members/${member.uid}`, { method: 'DELETE' });
            setMembers((m) => m.filter((x) => x.uid !== member.uid));
            setTeamMsg({ type: 'success', text: `${member.name} was removed.` });
        } catch (error) {
            setTeamMsg({ type: 'error', text: error.message || 'Could not remove member' });
        }
    };

    const handleUpdatePassword = async () => {
        setSecurityMsg({ type: '', text: '' });
        if (passwords.next.length < 8) return setSecurityMsg({ type: 'error', text: 'Use at least 8 characters for the new password.' });
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
                        ? 'That password is too weak.'
                        : error.message || 'Could not update password';
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
        } finally {
            setLoadingProfile(false);
        }
    };

    const handleSaveProfile = async () => {
        setSavingProfile(true);
        setProfileMsg({ type: '', text: '' });
        try {
            await apiClient('/auth/profile', {
                method: 'PUT',
                body: JSON.stringify({
                    displayName: profileData.fullName,
                    bio: profileData.bio,
                })
            });
            setProfileMsg({ type: 'success', text: 'Profile updated successfully!' });
            setTimeout(() => setProfileMsg({ type: '', text: '' }), 3000);
        } catch (error) {
            setProfileMsg({ type: 'error', text: error.message || 'Failed to update profile' });
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
                            to="/legal"
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
                            {profileMsg.text && (
                                <div
                                    className={`alert-banner mb-md ${profileMsg.type === 'error' ? 'error-banner' : 'success-banner'}`}
                                    style={{
                                        display: 'flex',
                                        gap: '8px',
                                        padding: '12px',
                                        borderRadius: '8px',
                                        alignItems: 'center',
                                        background: profileMsg.type === 'error' ? 'var(--error-bg, #ffebee)' : 'var(--success-bg, #e8f5e9)',
                                        color: profileMsg.type === 'error' ? 'var(--error, #d32f2f)' : 'var(--success, #2e7d32)'
                                    }}
                                >
                                    {profileMsg.type === 'error' ? <AlertCircle size={16} /> : <Check size={16} />}
                                    <span>{profileMsg.text}</span>
                                </div>
                            )}
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

                    {activeTab === 'workspace' && (
                        <div className="settings-section card">
                            <h3>Workspace Settings</h3>
                            <p style={{ color: 'var(--text-secondary)' }}>Workspace management features coming soon.</p>
                        </div>
                    )}

                    {activeTab === 'team' && (
                        <div className="settings-section card">
                            <div className="flex justify-between items-center mb-lg">
                                <h3>Team Members</h3>
                            </div>
                            <Banner msg={teamMsg} />

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
                                            <span className="badge badge-info" style={{ textTransform: 'capitalize' }}>{member.role}</span>
                                            {yourRole === 'owner' && member.role !== 'owner' ? (
                                                <button className="btn-icon btn-ghost text-error" title={`Remove ${member.name}`} onClick={() => handleRemove(member)}>
                                                    <Trash2 size={16} />
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
                                            <input type="password" className="input" placeholder="••••••••" autoComplete="new-password"
                                                value={passwords.next} onChange={(e) => setPasswords({ ...passwords, next: e.target.value })} />
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
                </main>
            </div>
        </div>
    );
}

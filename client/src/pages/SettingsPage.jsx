import { useState, useEffect } from 'react';
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
    AlertCircle
} from 'lucide-react';
import { apiClient } from '../lib/api';
import './Settings.css';

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
    const [profileData, setProfileData] = useState({ fullName: '', email: '', bio: '' });
    const [profileMsg, setProfileMsg] = useState({ type: '', text: '' });

    useEffect(() => {
        if (activeTab === 'profile') {
            fetchProfile();
        }
    }, [activeTab]);

    const fetchProfile = async () => {
        setLoadingProfile(true);
        try {
            const data = await apiClient('/auth/profile');
            setProfileData({
                fullName: data.user?.displayName || '',
                email: data.user?.email || '',
                bio: data.user?.bio || '',
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
                </aside>

                <main className="settings-content animate-slide-in">
                    {activeTab === 'profile' && (
                        <div className="settings-section card">
                            <h3>Profile Information</h3>
                            {profileMsg.text && (
                                <div className={`alert-banner mb-md ${profileMsg.type === 'error' ? 'error-banner' : 'success-banner'}`} style={{ display: 'flex', gap: '8px', padding: '12px', borderRadius: '8px', alignItems: 'center', background: profileMsg.type === 'error' ? 'var(--error-bg, #ffebee)' : 'var(--success-bg, #e8f5e9)', color: profileMsg.type === 'error' ? 'var(--error, #d32f2f)' : 'var(--success, #2e7d32)' }}>
                                    {profileMsg.type === 'error' ? <AlertCircle size={16} /> : <Check size={16} />}
                                    <span>{profileMsg.text}</span>
                                </div>
                            )}
                            <div className="profile-upload">
                                <div className="avatar-preview" />
                                <button className="btn btn-secondary btn-sm">Change Photo</button>
                            </div>

                            {loadingProfile ? (
                                <div className="flex justify-center p-xl">
                                    <Loader2 size={24} className="spin text-brand" />
                                </div>
                            ) : (
                                <div className="form-grid">
                                    <div className="input-group">
                                        <label>Full Name</label>
                                        <input type="text" className="input" value={profileData.fullName} onChange={e => setProfileData({ ...profileData, fullName: e.target.value })} />
                                    </div>
                                    <div className="input-group">
                                        <label>Email Address</label>
                                        <input type="email" className="input" value={profileData.email} disabled title="Email cannot be changed here" />
                                    </div>
                                    <div className="input-group full-width">
                                        <label>Bio</label>
                                        <textarea className="input" value={profileData.bio} onChange={e => setProfileData({ ...profileData, bio: e.target.value })} placeholder="Tell us about yourself..." />
                                    </div>
                                </div>
                            )}
                            <div className="section-footer">
                                <button className="btn btn-primary" onClick={handleSaveProfile} disabled={savingProfile || loadingProfile}>
                                    {savingProfile ? <><Loader2 size={18} className="spin" /> Saving...</> : <><Save size={18} /> Save Changes</>}
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'team' && (
                        <div className="settings-section card">
                            <div className="flex justify-between items-center mb-lg">
                                <h3>Team Members</h3>
                                <button className="btn btn-primary btn-sm"><Plus size={16} /> Invite Member</button>
                            </div>
                            <div className="team-list">
                                {[
                                    { name: 'Alex Johnson', email: 'alex@example.com', role: 'Owner' },
                                    { name: 'Sarah Miller', email: 'sarah.m@gmail.com', role: 'Admin' },
                                ].map(member => (
                                    <div key={member.email} className="team-item glass p-md mb-md flex items-center gap-md">
                                        <div className="member-avatar" />
                                        <div className="member-info flex-1">
                                            <span className="member-name">{member.name}</span>
                                            <span className="member-email">{member.email}</span>
                                        </div>
                                        <span className="badge badge-info">{member.role}</span>
                                        <button className="btn-icon btn-ghost text-error"><Trash2 size={16} /></button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {activeTab === 'security' && (
                        <div className="settings-section card">
                            <h3>Security Settings</h3>
                            <div className="form-grid">
                                <div className="input-group full-width">
                                    <label>Current Password</label>
                                    <input type="password" className="input" placeholder="••••••••" />
                                </div>
                                <div className="input-group">
                                    <label>New Password</label>
                                    <input type="password" className="input" placeholder="••••••••" />
                                </div>
                                <div className="input-group">
                                    <label>Confirm New Password</label>
                                    <input type="password" className="input" placeholder="••••••••" />
                                </div>
                            </div>
                            <div className="section-footer">
                                <button className="btn btn-primary"><Key size={18} /> Update Password</button>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}

import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { APPROVAL_PLANS } from '../../utils/planLimits';
import { useTheme } from '../../context/ThemeContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import {
    BadgeCheck,
    BarChart3,
    Calendar,
    ChevronLeft,
    ChevronRight,
    Clapperboard,
    CreditCard,
    FileVideo,
    Film,
    Flame,
    Layers,
    LayoutDashboard,
    Link2,
    LogOut,
    Megaphone,
    MessageCircle,
    Moon,
    Repeat2,
    Scissors,
    Settings,
    Sparkles,
    Sun,
    UserCircle,
    Users,
    Zap,
    Target,
} from 'lucide-react';
import './Sidebar.css';
import { KenganLogo } from '../brand/KenganLogo';

// Grouped by the job at hand: make content, get it out, talk to people, see what worked.
// Account pages (billing, settings) live in the footer to keep the list short.
const NAV_GROUPS = [
    {
        items: [{ label: 'Home', icon: LayoutDashboard, path: '/dashboard', end: true }],
    },
    {
        title: 'Make',
        items: [
            { label: 'Clips', icon: Film, path: '/dashboard/clips' },
            { label: 'Video editor', icon: Scissors, path: '/editor' },
            { label: 'Repurpose', icon: Repeat2, path: '/dashboard/repurpose' },
            { label: 'Launch video', icon: Clapperboard, path: '/dashboard/launch' },
            { label: 'AI writer', icon: Sparkles, path: '/dashboard/ai-tools' },
        ],
    },
    {
        title: 'Publish',
        items: [
            { label: 'Clients & approvals', icon: BadgeCheck, path: '/dashboard/clients', plans: APPROVAL_PLANS, tag: 'PRO' },
            { label: 'Calendar', icon: Calendar, path: '/dashboard/scheduler' },
            { label: 'New post', icon: FileVideo, path: '/dashboard/content' },
            { label: 'Trending ideas', icon: Flame, path: '/dashboard/trending' },
            { label: 'Connections', icon: Link2, path: '/dashboard/connections' },
        ],
    },
    {
        title: 'Engage',
        items: [
            { label: 'Inbox', icon: MessageCircle, path: '/dashboard/dm' },
            { label: 'Automation', icon: Zap, path: '/dashboard/automation' },
            { label: 'Leads', icon: Users, path: '/dashboard/leads' },
        ],
    },
    {
        title: 'Grow',
        items: [
            { label: 'Marketing', icon: Megaphone, path: '/dashboard/marketing' },
            { label: 'Meta Ads', icon: Target, path: '/dashboard/ads' },
        ],
    },
    {
        title: 'Results',
        items: [{ label: 'Analytics', icon: BarChart3, path: '/dashboard/analytics' }],
    },
];

export default function Sidebar() {
    const [collapsed, setCollapsed] = useState(false);
    const { user, profile, logout, plan } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const photo = profile?.photoURL || user?.photoURL;
    const name = profile?.displayName || user?.displayName || 'Account';
    const { workspaces, currentWorkspace, switchWorkspace } = useWorkspace();
    const canSwitch = workspaces.length > 1 && !!currentWorkspace;

    const handleSwitch = (e) => {
        const id = e.target.value;
        if (!id || id === currentWorkspace?.id) return;
        switchWorkspace(id);
        // Pages load their data for one workspace; reloading the current route is the
        // simplest way to make every page and cache pick up the new one.
        window.location.reload();
    };

    return (
        <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
            <div className="sidebar__logo">
                <KenganLogo size={26} showWordmark={!collapsed} />
            </div>

            {canSwitch && !collapsed ? (
                <div className="sidebar__workspace">
                    <label htmlFor="sidebar-workspace" className="sidebar__group-title">Workspace</label>
                    <select
                        id="sidebar-workspace"
                        className="sidebar__workspace-select"
                        value={currentWorkspace.id}
                        onChange={handleSwitch}
                    >
                        {workspaces.map((ws) => (
                            <option key={ws.id} value={ws.id}>
                                {ws.name || 'Untitled workspace'}{ws.role && ws.role !== 'owner' ? ` (${ws.role})` : ''}
                            </option>
                        ))}
                    </select>
                </div>
            ) : null}
            {canSwitch && collapsed ? (
                <button
                    type="button"
                    className="sidebar__icon-btn sidebar__workspace-icon"
                    onClick={() => setCollapsed(false)}
                    title={`Workspace: ${currentWorkspace.name || 'Untitled'}. Expand to switch.`}
                    aria-label={`Current workspace ${currentWorkspace.name || 'Untitled'}. Expand the sidebar to switch workspace.`}
                >
                    <Layers size={16} />
                </button>
            ) : null}

            <nav className="sidebar__nav" aria-label="App">
                {NAV_GROUPS.map((group, gi) => (
                    <div key={gi} className="sidebar__group">
                        {group.title && !collapsed ? <div className="sidebar__group-title">{group.title}</div> : null}
                        {group.items.map((item) => (
                            <NavLink
                                key={item.path}
                                to={item.path}
                                end={item.end}
                                className={({ isActive }) => `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`}
                                title={collapsed ? item.label : undefined}
                            >
                                <item.icon size={17} strokeWidth={1.8} />
                                {!collapsed && <span>{item.label}</span>}
                                {!collapsed && item.plans && !item.plans.includes(plan || 'starter') ? <span className="sidebar__tag">{item.tag}</span> : null}
                            </NavLink>
                        ))}
                    </div>
                ))}
            </nav>

            <div className="sidebar__footer">
                <div className="sidebar__user">
                    <div className="sidebar__user-avatar">
                        {photo ? <img src={photo} alt="" /> : <UserCircle size={18} />}
                    </div>
                    {!collapsed && (
                        <div className="sidebar__user-info">
                            <span className="sidebar__user-name">{name}</span>
                            <span className="sidebar__user-email">{user?.email}</span>
                        </div>
                    )}
                </div>
                <div className={`sidebar__footer-actions ${collapsed ? 'is-stacked' : ''}`}>
                    <button type="button" className="sidebar__icon-btn" onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
                        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                    </button>
                    <NavLink to="/dashboard/settings" className="sidebar__icon-btn" title="Settings" aria-label="Settings">
                        <Settings size={16} />
                    </NavLink>
                    <NavLink to="/dashboard/billing" className="sidebar__icon-btn" title="Plan and billing" aria-label="Plan and billing">
                        <CreditCard size={16} />
                    </NavLink>
                    <button type="button" className="sidebar__icon-btn" onClick={logout} title="Log out" aria-label="Log out">
                        <LogOut size={16} />
                    </button>
                    <button
                        type="button"
                        className="sidebar__icon-btn"
                        onClick={() => setCollapsed(!collapsed)}
                        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        aria-expanded={!collapsed}
                    >
                        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                    </button>
                </div>
            </div>
        </aside>
    );
}

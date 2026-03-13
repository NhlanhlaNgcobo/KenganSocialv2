import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import {
    LayoutDashboard,
    Link2,
    FileVideo,
    Calendar,
    Sparkles,
    BarChart3,
    Zap,
    Users,
    CreditCard,
    Settings,
    ChevronLeft,
    ChevronRight,
    Sun,
    Moon,
    LogOut,
    UserCircle,
} from 'lucide-react';
import './Sidebar.css';

const NAV_ITEMS = [
    { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
    { label: 'Connections', icon: Link2, path: '/dashboard/connections' },
    { label: 'Content', icon: FileVideo, path: '/dashboard/content' },
    { label: 'Scheduler', icon: Calendar, path: '/dashboard/scheduler' },
    { label: 'AI Tools', icon: Sparkles, path: '/dashboard/ai-tools' },
    { label: 'Analytics', icon: BarChart3, path: '/dashboard/analytics' },
    { label: 'Automation', icon: Zap, path: '/dashboard/automation' },
    { label: 'Leads', icon: Users, path: '/dashboard/leads' },
    { label: 'Billing', icon: CreditCard, path: '/dashboard/billing' },
    { label: 'Settings', icon: Settings, path: '/dashboard/settings' },
];

export default function Sidebar() {
    const [collapsed, setCollapsed] = useState(false);
    const { user, logout } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const location = useLocation();

    return (
        <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
            {/* Logo */}
            <div className="sidebar__logo">
                <div className="sidebar__logo-icon">K</div>
                {!collapsed && <span className="sidebar__logo-text">KenganSocial</span>}
            </div>

            {/* Navigation */}
            <nav className="sidebar__nav">
                {NAV_ITEMS.map((item) => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        className={({ isActive }) =>
                            `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`
                        }
                        title={collapsed ? item.label : undefined}
                    >
                        <item.icon size={20} />
                        {!collapsed && <span>{item.label}</span>}
                        {!collapsed && item.path === location.pathname && (
                            <span className="sidebar__link-indicator" />
                        )}
                    </NavLink>
                ))}
            </nav>

            {/* Bottom Actions */}
            <div className="sidebar__footer">
                {/* Theme Toggle */}
                <button
                    className="sidebar__footer-btn"
                    onClick={toggleTheme}
                    title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
                >
                    {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                    {!collapsed && <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>}
                </button>

                {/* User */}
                <div className="sidebar__user">
                    <div className="sidebar__user-avatar">
                        {user?.photoURL ? (
                            <img src={user.photoURL} alt="" />
                        ) : (
                            <UserCircle size={20} />
                        )}
                    </div>
                    {!collapsed && (
                        <div className="sidebar__user-info">
                            <span className="sidebar__user-name">
                                {user?.displayName || 'User'}
                            </span>
                            <span className="sidebar__user-email">{user?.email}</span>
                        </div>
                    )}
                </div>

                {/* Logout */}
                <button className="sidebar__footer-btn sidebar__logout" onClick={logout} title="Log out">
                    <LogOut size={18} />
                    {!collapsed && <span>Log Out</span>}
                </button>

                {/* Collapse toggle */}
                <button
                    className="sidebar__toggle"
                    onClick={() => setCollapsed(!collapsed)}
                    title={collapsed ? 'Expand' : 'Collapse'}
                >
                    {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                </button>
            </div>
        </aside>
    );
}

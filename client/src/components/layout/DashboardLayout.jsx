import { useEffect, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu, RefreshCw } from 'lucide-react';
import Sidebar from './Sidebar';
import { KenganLogo } from '../brand/KenganLogo';
import { useWorkspace } from '../../context/WorkspaceContext';
import { PHONE_QUERY, useMediaQuery } from '../../hooks/useMediaQuery';
import './DashboardLayout.css';

export default function DashboardLayout() {
    const { error: workspaceError, loading: workspaceLoading, fetchWorkspaces } = useWorkspace();
    // Phones: the sidebar is a drawer opened from the top bar, so pages get the full width.
    const phone = useMediaQuery(PHONE_QUERY);
    const [navOpen, setNavOpen] = useState(false);
    const drawerOpen = phone && navOpen;
    const menuButton = useRef(null);

    const closeNav = (returnFocus = false) => {
        setNavOpen(false);
        if (returnFocus) menuButton.current?.focus();
    };

    useEffect(() => {
        if (!drawerOpen) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape') {
                setNavOpen(false);
                menuButton.current?.focus();
            }
        };
        // The page behind the drawer shouldn't scroll under the finger.
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', onKey);
        return () => {
            document.body.style.overflow = overflow;
            document.removeEventListener('keydown', onKey);
        };
    }, [drawerOpen]);

    return (
        <div className="dashboard">
            <Sidebar phone={phone} open={drawerOpen} onClose={closeNav} />
            {drawerOpen ? <div className="dashboard__scrim" onClick={() => closeNav(true)} aria-hidden="true" /> : null}
            <main className="dashboard__main">
                <header className="dashboard__topbar">
                    <button
                        ref={menuButton}
                        type="button"
                        className="dashboard__menu"
                        onClick={() => setNavOpen(true)}
                        aria-label="Open menu"
                        aria-controls="app-sidebar"
                        aria-expanded={drawerOpen}
                    >
                        <Menu size={20} />
                    </button>
                    <KenganLogo size={24} />
                </header>
                <div className="dashboard__content animate-fade-in">
                    {/* Without a workspace no page can load its data: say so once, with a retry. */}
                    {workspaceError && (
                        <div className="error-banner dashboard__offline" role="alert">
                            <span>{workspaceError}</span>
                            <button className="btn btn-secondary btn-sm" onClick={fetchWorkspaces} disabled={workspaceLoading}>
                                <RefreshCw size={14} className={workspaceLoading ? 'spin' : ''} /> Try again
                            </button>
                        </div>
                    )}
                    <Outlet />
                </div>
            </main>
        </div>
    );
}

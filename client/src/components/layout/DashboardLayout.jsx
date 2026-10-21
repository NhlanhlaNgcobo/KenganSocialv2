import { Outlet } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import Sidebar from './Sidebar';
import { useWorkspace } from '../../context/WorkspaceContext';
import './DashboardLayout.css';

export default function DashboardLayout() {
    const { error: workspaceError, loading: workspaceLoading, fetchWorkspaces } = useWorkspace();
    return (
        <div className="dashboard">
            <Sidebar />
            <main className="dashboard__main">
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

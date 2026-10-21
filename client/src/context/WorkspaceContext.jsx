import { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { apiClient } from '../lib/api';

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ children }) {
    const { profile } = useAuth();
    const [workspaces, setWorkspaces] = useState([]);
    const [currentWorkspace, setCurrentWorkspace] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (profile) {
            fetchWorkspaces();
        } else {
            setWorkspaces([]);
            setCurrentWorkspace(null);
            localStorage.removeItem('kengan_current_workspace_id');
            setLoading(false);
        }
    }, [profile]);

    const fetchWorkspaces = async () => {
        try {
            setLoading(true);
            const data = await apiClient('/workspaces');
            const list = data.workspaces || [];
            setWorkspaces(list);

            // Keep the workspace picked in the switcher (stored across reloads), then fall back
            // to the profile default, the user's own workspace, or the first one available.
            const storedId = localStorage.getItem('kengan_current_workspace_id');
            const nextWorkspace =
                list.find(ws => ws.id === storedId)
                || list.find(ws => ws.id === profile.defaultWorkspaceId)
                || list.find(ws => ws.role === 'owner')
                || list[0]
                || null;
            setCurrentWorkspace(nextWorkspace);
            if (nextWorkspace?.id) {
                localStorage.setItem('kengan_current_workspace_id', nextWorkspace.id);
            } else {
                localStorage.removeItem('kengan_current_workspace_id');
            }
        } catch (error) {
            console.error('Failed to fetch workspaces:', error);
        } finally {
            setLoading(false);
        }
    };

    const switchWorkspace = (workspaceId) => {
        const ws = workspaces.find(w => w.id === workspaceId);
        if (ws) {
            setCurrentWorkspace(ws);
            localStorage.setItem('kengan_current_workspace_id', ws.id);
        }
    };

    const value = {
        workspaces,
        currentWorkspace,
        loading,
        fetchWorkspaces,
        switchWorkspace
    };

    return (
        <WorkspaceContext.Provider value={value}>
            {children}
        </WorkspaceContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs with its provider
export function useWorkspace() {
    const context = useContext(WorkspaceContext);
    if (!context) {
        throw new Error('useWorkspace must be used within a WorkspaceProvider');
    }
    return context;
}

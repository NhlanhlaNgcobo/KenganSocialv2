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
            setWorkspaces(data.workspaces);

            // Set current workspace from profile default or first available
            const defaultWs = data.workspaces.find(ws => ws.id === profile.defaultWorkspaceId);
            const nextWorkspace = defaultWs || data.workspaces[0] || null;
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

export function useWorkspace() {
    const context = useContext(WorkspaceContext);
    if (!context) {
        throw new Error('useWorkspace must be used within a WorkspaceProvider');
    }
    return context;
}

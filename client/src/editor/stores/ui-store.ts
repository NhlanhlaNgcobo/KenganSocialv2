import { create } from 'zustand';

export type PanelTab = 'media' | 'templates' | 'music' | 'lyrics' | 'stock' | 'text' | 'captions' | 'effects' | 'transitions' | 'ai' | 'settings';

interface UiState {
    activeTab: PanelTab;
    zoom: number;
    exportOpen: boolean;
    toast: { id: number; message: string; tone: 'info' | 'error' | 'success' } | null;
    setActiveTab: (tab: PanelTab) => void;
    setZoom: (zoom: number) => void;
    setExportOpen: (open: boolean) => void;
    notify: (message: string, tone?: 'info' | 'error' | 'success') => void;
    dismissToast: () => void;
}

export const useUiStore = create<UiState>((set) => ({
    activeTab: 'media',
    zoom: 1,
    exportOpen: false,
    toast: null,
    setActiveTab: (activeTab) => set({ activeTab }),
    setZoom: (zoom) => set({ zoom }),
    setExportOpen: (exportOpen) => set({ exportOpen }),
    notify: (message, tone = 'info') => set({ toast: { id: Date.now(), message, tone } }),
    dismissToast: () => set({ toast: null }),
}));

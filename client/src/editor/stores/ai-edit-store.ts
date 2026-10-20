import { create } from 'zustand';
import { aiEditApi, applyEditPlan, DEFAULT_EDIT_OPTIONS, waitForJob, type EditOptions, type EditPlan, type StyleProfile } from '../lib/ai-edit';
import { useMediaStore } from './media-store';

type Task = { stage: string; progress: number; error: string | null; running: boolean; code?: string };
const IDLE: Task = { stage: '', progress: 0, error: null, running: false };

interface AiEditState {
    open: boolean;
    presets: StyleProfile[];
    styles: StyleProfile[];
    loaded: boolean;
    loadError: string | null;
    selectedId: string | null;
    footageId: string | null;
    options: EditOptions;
    analysis: Task;
    edit: Task;
    plan: EditPlan | null;
    planMediaId: string | null;
    controllers: { analysis: AbortController | null; edit: AbortController | null };

    openStudio: () => void;
    close: () => void;
    load: () => Promise<void>;
    select: (id: string) => void;
    setFootage: (id: string | null) => void;
    setOptions: (partial: Partial<EditOptions>) => void;
    analyze: (input: { url?: string; file?: File }) => Promise<void>;
    cancelAnalysis: () => void;
    removeStyle: (id: string) => Promise<void>;
    updateStyle: (id: string, patch: Partial<StyleProfile>) => Promise<void>;
    runEdit: () => Promise<void>;
    cancelEdit: () => void;
    apply: () => void;
    reset: () => void;
}

export const useAiEditStore = create<AiEditState>((set, get) => ({
    open: false,
    presets: [],
    styles: [],
    loaded: false,
    loadError: null,
    selectedId: null,
    footageId: null,
    options: DEFAULT_EDIT_OPTIONS,
    analysis: IDLE,
    edit: IDLE,
    plan: null,
    planMediaId: null,
    controllers: { analysis: null, edit: null },

    openStudio: () => {
        set({ open: true });
        if (!get().loaded) get().load();
        // Default footage: the first video in the project.
        if (!get().footageId) {
            const video = useMediaStore.getState().items.find((i) => i.type === 'video');
            if (video) set({ footageId: video.id });
        }
    },
    close: () => set({ open: false }),

    load: async () => {
        try {
            const [presets, styles] = await Promise.all([aiEditApi.presets(), aiEditApi.styles()]);
            set((s) => ({ presets, styles, loaded: true, loadError: null, selectedId: s.selectedId || styles[0]?.id || presets[0]?.id || null }));
        } catch (error) {
            set({ loadError: (error as Error).message });
        }
    },

    select: (selectedId) => set({ selectedId }),
    setFootage: (footageId) => set({ footageId }),
    setOptions: (partial) => set((s) => ({ options: { ...s.options, ...partial } })),

    analyze: async ({ url, file }) => {
        get().controllers.analysis?.abort();
        const controller = new AbortController();
        set((s) => ({ analysis: { stage: file ? 'Uploading the reference' : 'Downloading the reference', progress: 2, error: null, running: true }, controllers: { ...s.controllers, analysis: controller } }));
        try {
            const jobId = file ? await aiEditApi.analyzeFile(file) : await aiEditApi.analyzeLink(url || '');
            const job = await waitForJob(jobId, (j) => set({ analysis: { stage: j.stage, progress: j.progress, error: null, running: true } }), controller.signal);
            const styles = await aiEditApi.styles();
            set({ styles, selectedId: job.styleId || styles[0]?.id || get().selectedId, analysis: IDLE });
        } catch (error) {
            const message = (error as Error).message;
            set({ analysis: message === 'Cancelled' ? IDLE : { ...IDLE, error: message, code: (error as Error & { code?: string }).code } });
        }
    },
    cancelAnalysis: () => {
        get().controllers.analysis?.abort();
        set({ analysis: IDLE });
    },

    removeStyle: async (id) => {
        await aiEditApi.deleteStyle(id);
        set((s) => {
            const styles = s.styles.filter((st) => st.id !== id);
            return { styles, selectedId: s.selectedId === id ? styles[0]?.id || s.presets[0]?.id || null : s.selectedId };
        });
    },

    updateStyle: async (id, patch) => {
        const style = await aiEditApi.updateStyle(id, patch);
        set((s) => ({ styles: s.styles.map((st) => (st.id === id ? style : st)) }));
    },

    runEdit: async () => {
        const { footageId, selectedId, options, presets } = get();
        if (!footageId) throw new Error('Choose the footage to edit.');
        if (!selectedId) throw new Error('Choose a style.');
        get().controllers.edit?.abort();
        const controller = new AbortController();
        set((s) => ({ edit: { stage: 'Uploading your footage', progress: 1, error: null, running: true }, plan: null, controllers: { ...s.controllers, edit: controller } }));
        try {
            const uploads = await useMediaStore.getState().ensureUploaded([footageId], (done, total) =>
                set({ edit: { stage: `Uploading your footage`, progress: Math.round((done / Math.max(1, total)) * 5), error: null, running: true } })
            );
            const isPreset = presets.some((p) => p.id === selectedId);
            const jobId = await aiEditApi.startEdit({
                sourceUploadId: uploads[footageId],
                ...(isPreset ? { presetId: selectedId } : { styleId: selectedId }),
                options,
            });
            const job = await waitForJob(jobId, (j) => set({ edit: { stage: j.stage, progress: Math.max(5, j.progress), error: null, running: true } }), controller.signal);
            set({ plan: job.plan || null, planMediaId: footageId, edit: IDLE });
        } catch (error) {
            const message = (error as Error).message;
            set({ edit: message === 'Cancelled' ? IDLE : { ...IDLE, error: message } });
        }
    },
    cancelEdit: () => {
        get().controllers.edit?.abort();
        set({ edit: IDLE });
    },

    apply: () => {
        const { plan, planMediaId } = get();
        if (!plan || !planMediaId) return;
        applyEditPlan(plan, planMediaId);
    },

    reset: () => set({ plan: null, planMediaId: null, edit: IDLE }),
}));

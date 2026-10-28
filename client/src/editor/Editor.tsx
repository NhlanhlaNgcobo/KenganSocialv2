/**
 * KenganSocial video editor. Layout and editing model follow OpenCut
 * (https://github.com/OpenCut-app/OpenCut, MIT); rendering and AI run on Kengan's backend.
 */
import { useEffect } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useEditorStore as useHandoffStore } from '../stores/editorStore';
import { EditorHeader } from './components/EditorHeader';
import { AiEditStudio } from './components/ai-edit/AiEditStudio';
import { ExportDialog } from './components/ExportDialog';
import { MediaPanel } from './components/media-panel/MediaPanel';
import { PreviewPanel } from './components/preview/PreviewPanel';
import { PropertiesPanel } from './components/properties/PropertiesPanel';
import { Timeline } from './components/timeline/Timeline';
import { Toast } from './components/Toast';
import { useEditorShortcuts } from './hooks/use-editor-shortcuts';
import { getElementEnd } from './lib/time';
import { useAiStore } from './stores/ai-store';
import { useMediaStore } from './stores/media-store';
import { usePlaybackStore } from './stores/playback-store';
import { getCanvasSize, startAutosave, useProjectStore } from './stores/project-store';
import { useTimelineStore } from './stores/timeline-store';
import { useUiStore } from './stores/ui-store';
import './editor.css';
import { perfEnabled } from './lib/perf';

/** Applies anything other pages queued for the editor (Content Studio upload, Trending template). */
async function consumeHandoff(projectKey: string) {
    const { file, words, viralClips } = useHandoffStore.getState().consume();
    if (file) {
        const [item] = await useMediaStore.getState().addFiles([file], projectKey);
        if (item) {
            const timeline = useTimelineStore.getState();
            const main = timeline.tracks.find((t) => t.isMain);
            const start = main?.elements.reduce((end, el) => Math.max(end, getElementEnd(el)), 0) ?? 0;
            timeline.addMediaAtTime(item, start, main?.id);
            useAiStore.getState().setSource(item.id);
        }
    }
    if (words?.length) {
        useTimelineStore.getState().addCaptions(
            words.map((w) => ({ text: w.text, start: w.start / 1000, end: w.end / 1000 })),
            useAiStore.getState().captionStyle,
            getCanvasSize(useProjectStore.getState().ratio).height
        );
    }
    if (viralClips?.length) {
        useAiStore.getState().setViralClips(viralClips);
        useUiStore.getState().setActiveTab('ai');
    }
}

function ResizeHandle({ direction }: { direction: 'horizontal' | 'vertical' }) {
    return <PanelResizeHandle className={`ke-resize is-${direction}`} />;
}

// Benchmark hook (scripts/bench-editor.mjs): only with editor diagnostics on (?perf=1).
if (perfEnabled && typeof window !== 'undefined') {
    (window as unknown as { __keBench: unknown }).__keBench = { media: useMediaStore, timeline: useTimelineStore, playback: usePlaybackStore, project: useProjectStore };
}

export default function Editor() {
    const { user } = useAuth();
    const status = useProjectStore((s) => s.status);
    const exportOpen = useUiStore((s) => s.exportOpen);

    useEditorShortcuts();

    useEffect(() => {
        if (!user?.uid) return undefined;
        let cancelled = false;
        let stopAutosave: (() => void) | null = null;
        const projectKey = `kengan-editor:${user.uid}`;
        (async () => {
            await useProjectStore.getState().load(projectKey);
            if (cancelled) return;
            await consumeHandoff(projectKey);
            stopAutosave = startAutosave();
        })();
        return () => {
            cancelled = true;
            stopAutosave?.();
            usePlaybackStore.getState().pause();
        };
    }, [user?.uid]);

    // Warn before leaving mid-export.
    useEffect(() => {
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            if (useUiStore.getState().exportOpen) e.preventDefault();
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [exportOpen]);

    if (status !== 'ready') {
        return (
            <div className="ke-root ke-loading">
                <Loader2 size={22} className="ke-spin" />
                <span>Loading your project…</span>
            </div>
        );
    }

    return (
        <div className="ke-root">
            <EditorHeader />
            <div className="ke-mobile-gate">
                <p>The editor needs a larger screen. Open KenganSocial on a laptop or desktop to edit video.</p>
            </div>
            <PanelGroup direction="vertical" autoSaveId="kengan-editor-rows" className="ke-layout">
                <Panel defaultSize={62} minSize={30} maxSize={85}>
                    <PanelGroup direction="horizontal" autoSaveId="kengan-editor-cols">
                        <Panel defaultSize={24} minSize={15} maxSize={40}>
                            <MediaPanel />
                        </Panel>
                        <ResizeHandle direction="horizontal" />
                        <Panel defaultSize={52} minSize={30}>
                            <PreviewPanel />
                        </Panel>
                        <ResizeHandle direction="horizontal" />
                        <Panel defaultSize={24} minSize={15} maxSize={40}>
                            <PropertiesPanel />
                        </Panel>
                    </PanelGroup>
                </Panel>
                <ResizeHandle direction="vertical" />
                <Panel defaultSize={38} minSize={15} maxSize={70}>
                    <Timeline />
                </Panel>
            </PanelGroup>
            <ExportDialog />
            <AiEditStudio />
            <Toast />
        </div>
    );
}

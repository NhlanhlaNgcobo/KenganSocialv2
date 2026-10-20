import { useEffect } from 'react';
import { useAiEditStore } from '../stores/ai-edit-store';
import { TIMELINE } from '../constants';
import { usePlaybackStore } from '../stores/playback-store';
import { useProjectStore } from '../stores/project-store';
import { useTimelineStore } from '../stores/timeline-store';
import { useUiStore } from '../stores/ui-store';

export const SHORTCUTS: [string, string][] = [
    ['Space', 'Play / pause'],
    ['← / →', 'Step one frame'],
    ['Shift + ← / →', 'Jump one second'],
    ['Home / End', 'Go to start / end'],
    ['S', 'Split at playhead'],
    ['T', 'Add text at playhead'],
    ['Delete', 'Delete selection'],
    ['Ctrl + D', 'Duplicate selection'],
    ['Ctrl + A', 'Select all'],
    ['Ctrl + Z', 'Undo'],
    ['Ctrl + Shift + Z', 'Redo'],
    ['N', 'Toggle snapping'],
    ['+ / -', 'Zoom timeline'],
    ['Esc', 'Clear selection'],
];

function isTyping(target: EventTarget | null) {
    const el = target as HTMLElement | null;
    if (!el) return false;
    return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export function useEditorShortcuts() {
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (isTyping(e.target) || useUiStore.getState().exportOpen || useAiEditStore.getState().open) return;
            const mod = e.ctrlKey || e.metaKey;
            const playback = usePlaybackStore.getState();
            const timeline = useTimelineStore.getState();
            const fps = useProjectStore.getState().fps;
            const key = e.key.toLowerCase();

            const handled = () => e.preventDefault();

            if (e.code === 'Space') {
                handled();
                playback.toggle();
            } else if (e.key === 'ArrowLeft') {
                handled();
                playback.seek(playback.currentTime - (e.shiftKey ? 1 : 1 / fps));
            } else if (e.key === 'ArrowRight') {
                handled();
                playback.seek(playback.currentTime + (e.shiftKey ? 1 : 1 / fps));
            } else if (e.key === 'Home') {
                handled();
                playback.seek(0);
            } else if (e.key === 'End') {
                handled();
                playback.seek(timeline.getTotalDuration());
            } else if (mod && key === 'z') {
                handled();
                if (e.shiftKey) timeline.redo();
                else timeline.undo();
            } else if (mod && key === 'y') {
                handled();
                timeline.redo();
            } else if (mod && key === 'd') {
                handled();
                timeline.duplicateSelected();
            } else if (mod && key === 'a') {
                handled();
                useTimelineStore.setState({
                    selected: timeline.tracks.flatMap((t) => t.elements.map((el) => ({ trackId: t.id, elementId: el.id }))),
                });
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                handled();
                timeline.removeSelected();
            } else if (!mod && key === 's') {
                handled();
                if (!timeline.splitAtPlayhead(playback.currentTime)) useUiStore.getState().notify('Move the playhead over a clip to split it.');
            } else if (!mod && key === 't') {
                handled();
                timeline.addTextAtTime(playback.currentTime);
            } else if (!mod && key === 'n') {
                handled();
                timeline.toggleSnapping();
            } else if (e.key === '+' || e.key === '=') {
                const ui = useUiStore.getState();
                ui.setZoom(Math.min(TIMELINE.MAX_ZOOM, ui.zoom * 1.25));
            } else if (e.key === '-') {
                const ui = useUiStore.getState();
                ui.setZoom(Math.max(TIMELINE.MIN_ZOOM, ui.zoom / 1.25));
            } else if (e.key === 'Escape') {
                timeline.clearSelection();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);
}

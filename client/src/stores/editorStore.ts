import { create } from 'zustand';

/**
 * Hand-off from other pages (Content Studio, Trending) into the editor.
 * The editor consumes and clears this on mount; the editor's own state lives in src/editor/stores.
 */
type Word = { text: string; start: number; end: number };
type ViralClip = { startSec: number; endSec: number; score: number; reason: string; thumbnailUrl: string | null };

interface EditorHandoffState {
    pendingFile: File | null;
    /** Words in milliseconds, matching the transcription service. */
    pendingWords: Word[] | null;
    pendingViralClips: ViralClip[] | null;
    setVideo: (file: File | null, url?: string) => void;
    setTranscription: (t: { words: Word[] }) => void;
    setViralClips: (clips: ViralClip[]) => void;
    consume: () => { file: File | null; words: Word[] | null; viralClips: ViralClip[] | null };
}

export const useEditorStore = create<EditorHandoffState>((set, get) => ({
    pendingFile: null,
    pendingWords: null,
    pendingViralClips: null,
    setVideo: (file) => set({ pendingFile: file }),
    setTranscription: (t) => set({ pendingWords: t.words }),
    setViralClips: (clips) => set({ pendingViralClips: clips }),
    consume: () => {
        const { pendingFile, pendingWords, pendingViralClips } = get();
        set({ pendingFile: null, pendingWords: null, pendingViralClips: null });
        return { file: pendingFile, words: pendingWords, viralClips: pendingViralClips };
    },
}));

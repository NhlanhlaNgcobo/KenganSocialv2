/**
 * Preview engine feature flag.
 *
 *  legacy  the original preview: the whole preview and timeline re-render on every playback frame
 *  v2      only what changes re-renders: the playhead moves without re-rendering the timeline, the
 *          preview re-renders when the visible clips change, and each clip or text layer updates
 *          per frame only while it animates (transitions, keyframes, effects, captions)
 *
 * Default comes from VITE_PREVIEW_ENGINE at build time (unset = legacy). A tester can override it
 * in their browser with ?preview=v2 or ?preview=legacy (remembered in localStorage), which is
 * also the immediate rollback for one person; for everyone, change VITE_PREVIEW_ENGINE and redeploy.
 */
export type PreviewEngine = 'legacy' | 'v2';

const KEY = 'kengan-preview';
const valid = (v: unknown): v is PreviewEngine => v === 'legacy' || v === 'v2';

function readEngine(): PreviewEngine {
    try {
        const fromUrl = new URLSearchParams(window.location.search).get('preview');
        if (valid(fromUrl)) {
            localStorage.setItem(KEY, fromUrl);
            return fromUrl;
        }
        const saved = localStorage.getItem(KEY);
        if (valid(saved)) return saved;
    } catch {
        /* no window or storage: fall through to the build default */
    }
    const fromBuild = import.meta.env.VITE_PREVIEW_ENGINE;
    return valid(fromBuild) ? fromBuild : 'legacy';
}

export const previewEngine: PreviewEngine = typeof window === 'undefined' ? 'legacy' : readEngine();
export const previewV2 = previewEngine === 'v2';

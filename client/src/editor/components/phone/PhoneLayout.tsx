/**
 * Phone editor. Landscape only, like CapCut: tool rail on the left, the preview filling the
 * middle, the timeline across the bottom. Media and clip settings slide in as drawers over the
 * preview (the rail button, a tap on the preview or Escape closes them). Portrait shows a rotate prompt.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Images, SlidersHorizontal, Smartphone } from 'lucide-react';
import { MediaPanel } from '../media-panel/MediaPanel';
import { PreviewPanel } from '../preview/PreviewPanel';
import { PropertiesPanel } from '../properties/PropertiesPanel';
import { Timeline } from '../timeline/Timeline';

type Sheet = 'media' | 'edit' | null;

const canLockLandscape = () =>
    typeof document !== 'undefined' &&
    !!document.fullscreenEnabled &&
    typeof screen !== 'undefined' &&
    typeof (screen.orientation as ScreenOrientation & { lock?: unknown })?.lock === 'function';

/** Full screen, then landscape. Android Chrome allows both; iPhone Safari allows neither. */
export async function enterLandscape() {
    try {
        if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        await (screen.orientation as ScreenOrientation & { lock: (o: string) => Promise<void> }).lock('landscape');
    } catch {
        // Not allowed here: the prompt already asks the person to turn the phone.
    }
}

export function RotatePrompt() {
    const [canLock] = useState(canLockLandscape);
    return (
        <div className="ke-root ke-rotate">
            <Link to="/dashboard" className="ke-icon-btn ke-rotate__back" aria-label="Back to dashboard">
                <ChevronLeft size={20} />
            </Link>
            <Smartphone size={44} strokeWidth={1.5} className="ke-rotate__icon" aria-hidden="true" />
            <h1>Turn your phone sideways</h1>
            <p>The editor works in landscape, so the preview and timeline both fit on screen.</p>
            {canLock ? (
                <button type="button" className="ke-btn ke-btn--primary ke-rotate__go" onClick={enterLandscape}>
                    Open in landscape
                </button>
            ) : null}
        </div>
    );
}

export function PhoneLayout() {
    const [sheet, setSheet] = useState<Sheet>(null);
    const toggle = (next: Exclude<Sheet, null>) => setSheet((s) => (s === next ? null : next));

    useEffect(() => {
        if (!sheet) return undefined;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSheet(null);
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [sheet]);

    return (
        <div className="ke-phone">
            <div className="ke-phone__main">
                <nav className="ke-phone__rail" aria-label="Panels">
                    <button type="button" className={sheet === 'media' ? 'is-active' : ''} aria-pressed={sheet === 'media'} onClick={() => toggle('media')}>
                        <Images size={20} />
                        <span>Media</span>
                    </button>
                    <button type="button" className={sheet === 'edit' ? 'is-active' : ''} aria-pressed={sheet === 'edit'} onClick={() => toggle('edit')}>
                        <SlidersHorizontal size={20} />
                        <span>Edit</span>
                    </button>
                </nav>
                <div className="ke-phone__stage">
                    <PreviewPanel />
                    {sheet ? <div className="ke-phone__scrim" onClick={() => setSheet(null)} aria-hidden="true" /> : null}
                    {/* Both stay mounted so a half-finished upload or edit survives closing the drawer. */}
                    <section className={`ke-phone__sheet is-left ${sheet === 'media' ? 'is-open' : ''}`} aria-label="Media">
                        <MediaPanel />
                    </section>
                    <section className={`ke-phone__sheet is-right ${sheet === 'edit' ? 'is-open' : ''}`} aria-label="Edit">
                        <PropertiesPanel />
                    </section>
                </div>
            </div>
            <div className="ke-phone__timeline">
                <Timeline />
            </div>
        </div>
    );
}

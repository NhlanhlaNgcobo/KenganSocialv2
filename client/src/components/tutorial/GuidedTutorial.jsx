import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, GraduationCap, RotateCcw, X } from 'lucide-react';
import './GuidedTutorial.css';

const storageKey = (id) => `kengan-tutorial-${id}`;

function readSeen(id) {
    try {
        return localStorage.getItem(storageKey(id)) === 'understood';
    } catch {
        return false;
    }
}

/**
 * A step-by-step walkthrough with an animated scene per step. It opens by itself the first time a
 * page is visited and stays closed once the person clicks "Okay, I understand" (remembered in this
 * browser). `useTutorial` gives the page a button to open it again.
 *
 * steps: [{ title, body, scene }] where scene is a small animated mock-up (see scenes.jsx).
 */
export default function GuidedTutorial({ id, title, steps, open, onClose }) {
    const [index, setIndex] = useState(0);
    const [replay, setReplay] = useState(0);
    const okRef = useRef(null);
    const step = steps[index];
    const last = index === steps.length - 1;

    const understood = useCallback(() => {
        try {
            localStorage.setItem(storageKey(id), 'understood');
        } catch {
            // Private windows can refuse storage; the tutorial just shows again next time.
        }
        setIndex(0);
        onClose();
    }, [id, onClose]);

    useEffect(() => {
        if (!open) return undefined;
        okRef.current?.focus();
        const onKey = (e) => {
            if (e.key === 'Escape') understood();
            if (e.key === 'ArrowRight') setIndex((i) => Math.min(steps.length - 1, i + 1));
            if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, steps.length, understood]);

    if (!open) return null;

    return (
        <div className="gt-backdrop" role="presentation">
            <div className="gt-dialog" role="dialog" aria-modal="true" aria-labelledby="gt-title">
                <header className="gt-head">
                    <span className="gt-kicker">
                        <GraduationCap size={15} /> {title}
                    </span>
                    <button className="gt-close" onClick={understood} aria-label="Close the tutorial">
                        <X size={18} />
                    </button>
                </header>

                {/* Keyed by step (and replay) so each scene's animation starts from the beginning. */}
                <div className="gt-stage">
                    <div className="gt-scene" key={`${index}-${replay}`} aria-hidden="true">
                        {step.scene}
                    </div>
                    <button className="gt-replay" onClick={() => setReplay((n) => n + 1)}>
                        <RotateCcw size={11} /> Replay
                    </button>
                </div>

                <div className="gt-copy" key={`copy-${index}`}>
                    <span className="gt-count">
                        Step {index + 1} of {steps.length}
                    </span>
                    <h2 id="gt-title">{step.title}</h2>
                    <p>{step.body}</p>
                </div>

                <footer className="gt-foot">
                    <div className="gt-dots" role="tablist" aria-label="Steps">
                        {steps.map((s, i) => (
                            <button
                                key={s.title}
                                role="tab"
                                aria-selected={i === index}
                                aria-label={`Step ${i + 1}: ${s.title}`}
                                className={`gt-dot ${i === index ? 'is-active' : ''} ${i < index ? 'is-done' : ''}`}
                                onClick={() => setIndex(i)}
                            />
                        ))}
                    </div>
                    <div className="gt-actions">
                        {index > 0 && (
                            <button className="btn btn-ghost" onClick={() => setIndex(index - 1)}>
                                <ArrowLeft size={16} /> Back
                            </button>
                        )}
                        {!last && (
                            <button className="btn btn-secondary" onClick={() => setIndex(index + 1)}>
                                Next <ArrowRight size={16} />
                            </button>
                        )}
                        <button ref={okRef} className={`btn ${last ? 'btn-primary' : 'btn-ghost'}`} onClick={understood}>
                            Okay, I understand
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
}

/** Open state for a page's tutorial: open on the first visit, plus a function to reopen it. */
// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs with the component
export function useTutorial(id) {
    const [open, setOpen] = useState(() => !readSeen(id));
    return { open, show: () => setOpen(true), close: () => setOpen(false) };
}

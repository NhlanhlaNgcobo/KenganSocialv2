import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { dialogStore } from '../../lib/dialogs';
import './DialogHost.css';

/** Shows the confirm/prompt dialogs requested through lib/dialogs.js, one at a time. */
export default function DialogHost() {
    const request = useSyncExternalStore(dialogStore.subscribe, dialogStore.current, () => null);
    if (!request) return null;
    // Keyed so each request starts with its own input value and focus.
    return createPortal(<Dialog key={request.id} request={request} />, document.body);
}

function Dialog({ request }) {
    const isPrompt = request.kind === 'prompt';
    const [value, setValue] = useState(isPrompt ? request.defaultValue : '');
    const box = useRef(null);
    const primary = useRef(null);
    const secondary = useRef(null);
    const input = useRef(null);

    const cancel = () => dialogStore.settle(isPrompt ? null : false);
    const submit = (e) => {
        e.preventDefault();
        dialogStore.settle(isPrompt ? value : true);
    };

    useEffect(() => {
        const returnTo = document.activeElement;
        // A destructive action starts on Cancel, so a stray Enter doesn't delete anything.
        if (isPrompt) input.current?.select();
        else (request.danger ? secondary : primary).current?.focus();
        return () => {
            if (returnTo instanceof HTMLElement && document.contains(returnTo)) returnTo.focus();
        };
    }, [isPrompt, request.danger]);

    const onKeyDown = (e) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            cancel();
            return;
        }
        // Keep Tab inside the dialog.
        if (e.key !== 'Tab') return;
        const items = [...box.current.querySelectorAll('button, input')];
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    };

    return (
        <div className="kd-overlay" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
            <form
                ref={box}
                className="kd-dialog"
                role={isPrompt ? 'dialog' : 'alertdialog'}
                aria-modal="true"
                aria-labelledby={request.title ? 'kd-title' : 'kd-message'}
                aria-describedby={request.title ? 'kd-message' : undefined}
                onSubmit={submit}
                onKeyDown={onKeyDown}
            >
                {request.title ? <h2 id="kd-title" className="kd-title">{request.title}</h2> : null}
                <p id="kd-message" className="kd-message">{request.message}</p>
                {isPrompt ? (
                    <input
                        ref={input}
                        className="input kd-input"
                        value={value}
                        placeholder={request.placeholder}
                        onChange={(e) => setValue(e.target.value)}
                        aria-labelledby="kd-message"
                    />
                ) : null}
                <div className="kd-actions">
                    <button ref={secondary} type="button" className="btn btn-secondary" onClick={cancel}>
                        {request.cancelLabel}
                    </button>
                    <button ref={primary} type="submit" className={`btn ${request.danger ? 'btn-danger' : 'btn-primary'}`}>
                        {request.confirmLabel}
                    </button>
                </div>
            </form>
        </div>
    );
}

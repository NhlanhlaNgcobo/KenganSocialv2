import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useUiStore } from '../stores/ui-store';

export function Toast() {
    const toast = useUiStore((s) => s.toast);
    const dismiss = useUiStore((s) => s.dismissToast);

    useEffect(() => {
        if (!toast) return undefined;
        const timer = setTimeout(dismiss, toast.tone === 'error' ? 6000 : 3500);
        return () => clearTimeout(timer);
    }, [toast, dismiss]);

    if (!toast) return null;
    return (
        <div className={`ke-toast is-${toast.tone}`} role="status">
            <span>{toast.message}</span>
            <button className="ke-icon-btn ke-icon-btn--xs" onClick={dismiss} aria-label="Dismiss">
                <X size={12} />
            </button>
        </div>
    );
}

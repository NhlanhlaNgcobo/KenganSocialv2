/**
 * In-app replacements for window.confirm / window.prompt. Both return a promise:
 *   if (!(await confirmDialog('Delete this draft?', { confirmLabel: 'Delete', danger: true }))) return;
 *   const name = await promptDialog('Name this template', { defaultValue: 'My template' }); // null if cancelled
 * <DialogHost /> (mounted once in App) shows them one at a time.
 */
let queue = [];
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export const dialogStore = {
    subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    },
    current: () => queue[0] || null,
    settle(value) {
        const [head, ...rest] = queue;
        if (!head) return;
        queue = rest;
        head.resolve(value);
        emit();
    },
};

function open(request) {
    return new Promise((resolve) => {
        queue = [...queue, { ...request, id: Math.random().toString(36).slice(2), resolve }];
        emit();
    });
}

/**
 * Resolves true (confirmed) or false.
 * @param {string} message
 * @param {{ title?: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean }} [options]
 * @returns {Promise<boolean>}
 */
export function confirmDialog(message, { title, confirmLabel = 'Continue', cancelLabel = 'Cancel', danger = false } = {}) {
    return open({ kind: 'confirm', message, title, confirmLabel, cancelLabel, danger });
}

/**
 * Resolves the entered text, or null when cancelled.
 * @param {string} message
 * @param {{ title?: string, defaultValue?: string, placeholder?: string, confirmLabel?: string, cancelLabel?: string }} [options]
 * @returns {Promise<string | null>}
 */
export function promptDialog(message, { title, defaultValue = '', placeholder = '', confirmLabel = 'Save', cancelLabel = 'Cancel' } = {}) {
    return open({ kind: 'prompt', message, title, defaultValue, placeholder, confirmLabel, cancelLabel });
}

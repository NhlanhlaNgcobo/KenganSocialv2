/**
 * Click ripple for every .btn: a soft circle spreads from where the button was pressed
 * (styles: .btn-ripple in index.css). One listener for the whole app; nothing to add per button.
 * Skipped for people who ask for reduced motion.
 */
export function installButtonRipple() {
    if (typeof window === 'undefined' || window.__kenganRipple) return;
    window.__kenganRipple = true;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    document.addEventListener(
        'pointerdown',
        (e) => {
            if (reduce?.matches || e.button !== 0) return;
            const btn = e.target instanceof Element ? e.target.closest('.btn') : null;
            if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
            const rect = btn.getBoundingClientRect();
            const ripple = document.createElement('span');
            ripple.className = 'btn-ripple';
            ripple.setAttribute('aria-hidden', 'true');
            ripple.style.setProperty('--x', `${e.clientX - rect.left}px`);
            ripple.style.setProperty('--y', `${e.clientY - rect.top}px`);
            ripple.style.setProperty('--size', `${Math.hypot(rect.width, rect.height) * 2}px`);
            btn.appendChild(ripple);
            ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
            setTimeout(() => ripple.remove(), 1000);
        },
        { passive: true }
    );
}

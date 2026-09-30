/**
 * Make the designer canvas's blocks clickable.
 *
 * The canvas is the real invoice page in a same-origin blob iframe. That
 * document inherits the app's Content-Security-Policy, which blocks inline
 * scripts (see utils/invoicePrintButton.js), so everything is attached from
 * the app side. Styles are not restricted by the policy.
 */

// Inside the invoice page, so it may use the page's own --tint.
const DESIGNER_CSS = `
.no-print { display: none !important; }
[data-block] { cursor: pointer; border-radius: 12px; transition: box-shadow 0.12s ease; }
[data-block]:hover { box-shadow: 0 0 0 2px color-mix(in srgb, var(--tint) 40%, transparent); }
[data-block].is-selected { box-shadow: 0 0 0 2px var(--tint); }
`;

export function wireDesignerFrame(win, onSelect) {
    const doc = win.document;
    if (doc.querySelector('style[data-designer]')) return;
    const style = doc.createElement('style');
    style.setAttribute('data-designer', '');
    style.textContent = DESIGNER_CSS;
    doc.head.appendChild(style);
    doc.addEventListener('click', (event) => {
        const block = event.target.closest && event.target.closest('[data-block]');
        if (block) onSelect(block.getAttribute('data-block'));
    });
}

export function markSelected(doc, id) {
    doc.querySelectorAll('[data-block].is-selected').forEach(el => el.classList.remove('is-selected'));
    if (!id) return;
    const el = doc.querySelector(`[data-block="${CSS.escape ? CSS.escape(id) : id}"]`);
    if (!el) return;
    el.classList.add('is-selected');
    if (el.scrollIntoView) el.scrollIntoView({block: 'nearest', behavior: 'smooth'});
}

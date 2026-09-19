/**
 * Attach the invoice page's Print button from the app side.
 *
 * The invoice is shown as a same-origin blob document: a new window in
 * printInvoice.js, an iframe in the template editor's preview. Such a document
 * inherits this app's Content-Security-Policy, which blocks inline event
 * handlers (verified in Chrome), so the backend's skeleton carries only a
 * `data-invoice-print` marker and the click is wired here.
 *
 * @param {Window} win - the invoice document's window
 */
export default function wireInvoicePrintButton(win) {
    const wire = () => {
        const button = win.document.querySelector('[data-invoice-print]');
        if (button) button.addEventListener('click', () => win.print());
    };
    // A just-opened window still shows its blank initial page, with no button;
    // the invoice replaces it and fires load on the same window object.
    if (win.document.querySelector('[data-invoice-print]')) {
        wire();
    } else {
        win.addEventListener('load', wire);
    }
}

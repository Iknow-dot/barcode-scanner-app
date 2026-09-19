import wireInvoicePrintButton from './invoicePrintButton';

const invoiceDocument = (withButton = true) => {
    const doc = document.implementation.createHTMLDocument('Invoice');
    doc.body.innerHTML = withButton
        ? '<div class="no-print"><button type="button" data-invoice-print>Print</button></div><p>invoice</p>'
        : '<p>invoice</p>';
    return doc;
};

// A stand-in for the invoice window: a real document, a spy for print(), and
// load listeners we can fire when the "navigation" finishes.
const fakeWindow = (doc) => {
    const listeners = [];
    return {
        document: doc,
        print: jest.fn(),
        addEventListener: (type, fn) => { if (type === 'load') listeners.push(fn); },
        finishLoading(nextDoc) { this.document = nextDoc; listeners.forEach((fn) => fn()); },
    };
};

describe('wireInvoicePrintButton', () => {
    it('wires a document that has already loaded (the preview iframe)', () => {
        const win = fakeWindow(invoiceDocument());
        wireInvoicePrintButton(win);
        win.document.querySelector('[data-invoice-print]').click();
        expect(win.print).toHaveBeenCalledTimes(1);
    });

    it('waits for the invoice to replace the blank page (the new window)', () => {
        const win = fakeWindow(invoiceDocument(false)); // window.open's initial about:blank
        wireInvoicePrintButton(win);
        win.finishLoading(invoiceDocument());
        win.document.querySelector('[data-invoice-print]').click();
        expect(win.print).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the page has no print button', () => {
        const win = fakeWindow(invoiceDocument(false));
        expect(() => { wireInvoicePrintButton(win); win.finishLoading(invoiceDocument(false)); })
            .not.toThrow();
        expect(win.print).not.toHaveBeenCalled();
    });
});

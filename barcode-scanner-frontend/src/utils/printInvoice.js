import {orderService} from '../api';

/**
 * Fetch the invoice HTML for an order through the authenticated axios
 * client, then open it in a new browser tab via a Blob URL so the user
 * can use the browser's native print dialog.
 *
 * Why blob-and-open instead of `window.open(url)`: the invoice endpoint
 * requires the JWT bearer header, which a plain `window.open` cannot
 * carry. Fetching first via the existing axios instance keeps the auth
 * model unchanged.
 *
 * @param {number} orderId
 * @param {object} t   - translations bundle (from useLanguage())
 * @param {object} notify - notification helper (from useAppNotification())
 */
export async function printInvoice(orderId, t, notify) {
    const result = await orderService.fetchInvoiceHtml(orderId);
    if (!result.success) {
        notify.error(t.orderError, result.error || t.invoicePrintFailed);
        return;
    }
    const blob = new Blob([result.data], {type: 'text/html'});
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) {
        notify.warning(t.invoiceWindowBlocked, t.invoiceWindowBlockedDesc);
        URL.revokeObjectURL(url);
        return;
    }
    // Backstop revoke — most users will print-and-close well before this fires.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Why a product's warehouse balances could not be shown.
 *
 * Since the catalog/stock split there is no `stock_status` to read from the
 * catalog answer: it always sends the vestigial `"pending"` (deploy-window
 * padding — see core/views/products.py) and never talks to 1C at all. The real
 * value is the stock call's per-item `status`, which UserDashboard copies onto
 * this state once that answer lands, mapping `ok` to `''`. `pending` is the
 * frontend's own in-flight marker for the window between the two answers.
 *
 * The cases need different wording because only some of them are worth
 * retrying, and the in-flight one is not a failure at all.
 */

/** The live 1C lookup failed — a retry may succeed. */
export const STOCK_STATUS_UNAVAILABLE = 'unavailable';

/** 1C was never asked: the catalog row has no article and no barcode to send. */
export const STOCK_STATUS_NO_LOOKUP_KEY = 'no_lookup_key';

/** Stock has been asked for but has not arrived yet — show a skeleton, not a warning. */
export const STOCK_STATUS_PENDING = 'pending';

/**
 * Whether balances must be hidden behind a warning. Any non-empty status
 * counts except `pending`, so a status added on the backend later degrades to
 * the generic warning instead of silently rendering an empty balance list as
 * if it were real — but the in-flight state does not.
 */
export const isStockBlocked = (status) => Boolean(status) && status !== STOCK_STATUS_PENDING;

/** Translation key explaining the blocked balances. */
export const stockStatusMessageKey = (status) => (
    status === STOCK_STATUS_NO_LOOKUP_KEY ? 'stockLookupKeyMissing' : 'stockUnavailable'
);

/**
 * Whether a search produced something worth showing.
 *
 * A resolved product counts even with no stock anywhere: its card, price and
 * images must render rather than collapsing to the "nothing scanned yet" empty
 * state. Balances alone also count, so a result never disappears just because
 * the product payload was thinner than expected.
 */
export const hasProductResult = (productInfo, balances) => (
    Boolean(productInfo?.sku) || (balances || []).length > 0
);

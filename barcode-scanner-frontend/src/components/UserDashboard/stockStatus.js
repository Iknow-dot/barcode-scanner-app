/**
 * Why a product's warehouse balances could not be shown.
 *
 * The backend sends `stock_status` on a product search only when the balance
 * list is not trustworthy. The two cases need different wording because only
 * one of them is worth retrying.
 */

/** The live 1C lookup failed — a retry may succeed. */
export const STOCK_STATUS_UNAVAILABLE = 'unavailable';

/** 1C was never asked: the catalog row has no article and no barcode to send. */
export const STOCK_STATUS_NO_LOOKUP_KEY = 'no_lookup_key';

/**
 * Whether balances must be hidden. Any non-empty status counts, so a status
 * added on the backend later degrades to the generic warning instead of
 * silently rendering an empty balance list as if it were real.
 */
export const isStockBlocked = (status) => Boolean(status);

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

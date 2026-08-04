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

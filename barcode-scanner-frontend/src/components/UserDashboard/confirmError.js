/**
 * Map a failed order-confirm result to a localized notification.
 *
 * Covers the coded 400s the backend raises while pushing the order to 1C on
 * confirm (the CreateOrder guards). Returns { title, message } where
 * `message` may be multi-line (render with white-space: pre-line), or null
 * for codes this map does not know — the caller falls back to the flattened
 * `result.error` detail.
 *
 * For ORDER_CREATE_REJECTED the upstream 1C reason (e.g. "Customer not found
 * by ClientIDPhone: ...") is appended as a second line beneath the localized
 * headline — it is English but carries the actionable specifics.
 *
 * @param {object} result - Failed apiRequest result ({ code, error, data }).
 * @param {object} t - Translation table for the active language.
 * @returns {{title: string, message: string}|null}
 */
const formatConfirmError = (result, t) => {
    switch (result.code) {
        case 'ORDER_CREATE_REJECTED': {
            const upstream = result.data?.detail;
            return {
                title: t.orderCreateRejectedTitle,
                message: upstream
                    ? `${t.orderCreateRejected}\n${upstream}`
                    : t.orderCreateRejected,
            };
        }
        case 'MULTIPLE_WAREHOUSES':
            return {title: t.orderError, message: t.multipleWarehousesError};
        case 'MISSING_WAREHOUSE':
            return {title: t.orderError, message: t.missingWarehouseError};
        case 'EMPTY_ORDER':
            return {title: t.orderError, message: t.emptyOrderError};
        case 'MISSING_CLIENT':
            return {title: t.orderError, message: t.missingClientError};
        case 'ITEM_LOOKUP_KEY_MISSING': {
            const sku = result.data?.sku;
            return {
                title: t.orderError,
                message: sku
                    ? t.itemLookupKeyMissingError(sku)
                    : t.itemLookupKeyMissingGeneric,
            };
        }
        default:
            return null;
    }
};

export default formatConfirmError;

/**
 * Build the notification body for an INSUFFICIENT_STOCK confirm rejection.
 *
 * The backend's `items` list carries one entry per short (product, warehouse)
 * pair: { sku, sku_name, warehouse_code, warehouse_name, requested, available }.
 * Returns one line per entry joined with '\n' (render with white-space:
 * pre-line), or the generic message when the backend sent no detail.
 *
 * @param {Array<object>|undefined} items - Shortage entries from the backend.
 * @param {object} t - Translation table for the active language.
 * @returns {string}
 */
const formatInsufficientStock = (items, t) => {
    if (!Array.isArray(items) || items.length === 0) {
        return t.insufficientStockGeneric;
    }
    return items
        .map((item) => {
            const name = item.sku_name || item.sku || '';
            const warehouse = item.warehouse_name || item.warehouse_code || '';
            const line = t.insufficientStockLine(item.requested, item.available);
            return `${name} (${warehouse}): ${line}`;
        })
        .join('\n');
};

export default formatInsufficientStock;

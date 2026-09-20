import api from '../request';
import API_ENDPOINTS from '../endpoints';

const toWarehouseList = (warehouseCodes) => {
    if (Array.isArray(warehouseCodes)) return warehouseCodes;
    if (typeof warehouseCodes === 'string' && warehouseCodes.length > 0) {
        return warehouseCodes.split(',').map((c) => c.trim()).filter(Boolean);
    }
    return [];
};

/**
 * Read a product from the org's local catalog replica. Never talks to 1C, so
 * it answers in milliseconds and cannot fail on an external service.
 *
 * A 404 here carries `PRODUCT_NOT_IN_CATALOG`, which is NOT "the product does
 * not exist" — 1C may know a product that has not been pushed to us yet. Pair
 * it with fetchStock to reach a verdict.
 *
 * @param {object} params
 * @param {string} params.sku - the SKU or barcode value
 * @param {string} params.searchType - 'barcode' or 'article'
 * @param {boolean} [params.recordScan=false] - count this lookup in the scan
 *   analytics. Only lookups the consultant started pass it.
 */
export const searchProduct = ({sku, searchType, recordScan = false}) => {
    const body = {sku, is_barcode: searchType === 'barcode'};
    if (recordScan) body.record_scan = true;
    return api.post(API_ENDPOINTS.product_search, body);
};

/**
 * Live stock for one or more SKUs, in a single request.
 *
 * Always resolves with a 200 whose `results` carry a per-item `status`
 * (`ok` | `unavailable` | `no_lookup_key` | `not_found`), keyed by the value
 * that was requested. A row may also carry `unit`, the per-lookup-key unit
 * 1C reports, present only when 1C sent one, and `product`, the identity the
 * backend just learned from 1C for a SKU missing from the replica — present
 * only when that call self-healed a replica miss.
 *
 * @param {object} params
 * @param {{sku: string, isBarcode?: boolean}[]} params.items
 * @param {string[]|string} [params.warehouseCodes] - empty → all warehouses
 */
export const fetchStock = ({items, warehouseCodes}) => api.post(API_ENDPOINTS.product_stock, {
    items: (items || []).map(({sku, isBarcode}) => ({sku, is_barcode: Boolean(isBarcode)})),
    warehouses: toWarehouseList(warehouseCodes),
});

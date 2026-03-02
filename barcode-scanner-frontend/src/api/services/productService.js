import api from '../request';
import API_ENDPOINTS from '../endpoints';

/**
 * Search for a product by SKU or barcode.
 *
 * @param {string} sku - The SKU or barcode value
 * @param {string} searchType - 'barcode' or 'article'
 * @param {string[]|string} warehouseCodes - Warehouse codes to search in
 */
export const searchProduct = (sku, searchType, warehouseCodes) => {
    const is_barcode = searchType === 'barcode';

    let warehouses;
    if (Array.isArray(warehouseCodes)) {
        warehouses = warehouseCodes;
    } else if (typeof warehouseCodes === 'string' && warehouseCodes.length > 0) {
        warehouses = warehouseCodes.split(',').map(c => c.trim()).filter(Boolean);
    } else {
        warehouses = [];
    }

    return api.post(API_ENDPOINTS.product_search, {
        sku,
        is_barcode,
        warehouses,
    });
};

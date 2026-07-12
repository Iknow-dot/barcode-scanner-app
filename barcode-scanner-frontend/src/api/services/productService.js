import api from '../request';
import API_ENDPOINTS from '../endpoints';

/**
 * Search for a product by SKU or barcode.
 *
 * @param {object} params
 * @param {string} params.sku - The SKU or barcode value
 * @param {string} params.searchType - 'barcode' or 'article'
 * @param {string[]|string} [params.warehouseCodes] - Warehouse codes to search in. Empty array → all warehouses.
 * @param {boolean} [params.includeImages=true] - Deprecated/no-op: the backend now always returns `images` as
 *   cheap proxy path strings (see catalogService.imageUrl) rather than inlined base64, so this flag no longer
 *   changes response size or shape. Kept for backward compatibility with existing call sites.
 */
export const searchProduct = ({sku, searchType, warehouseCodes, includeImages = true}) => {
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
        include_images: includeImages,
    });
};

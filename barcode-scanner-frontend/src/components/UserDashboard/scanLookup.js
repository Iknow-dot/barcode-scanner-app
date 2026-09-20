/**
 * Assembling one scan's verdict from two independent answers.
 *
 * The catalog read and the stock call go out in parallel; neither alone can
 * say whether a product exists. A catalog miss means only "not in the replica"
 * — 1C may know a product that has not been pushed to us yet — so the verdict
 * is not-found only when the catalog missed AND the stock call learned no
 * identity for it either.
 */

const DEGRADED = {status: 'unavailable', stock: [], unit: '', product: null};

/**
 * The single result of a one-item stock request, normalised.
 *
 * A transport failure degrades to `unavailable`, never to `not_found`: a
 * network blip must not be reported to the consultant as "no such product".
 */
export const firstStockEntry = (stockResult) => {
    const entry = stockResult?.success ? stockResult.data?.results?.[0] : null;
    if (!entry) return {...DEGRADED};
    return {
        status: entry.status || 'unavailable',
        stock: entry.stock || [],
        unit: entry.unit || '',
        product: entry.product || null,
    };
};

/** Whether the scan produced something worth rendering. */
export const scanVerdict = ({catalogResult, stockEntry}) => (
    catalogResult?.success || stockEntry?.product ? 'found' : 'not_found'
);

/**
 * The product card's fields, preferring the replica row and falling back to
 * the identity the stock call just learned from 1C.
 */
export const productInfoFrom = ({catalogData, stockEntry, search, searchType}) => {
    const source = catalogData || stockEntry?.product;
    if (!source) return null;
    return {
        sku: source.sku,
        sku_name: source.sku_name,
        article: source.article,
        price: source.price,
        images: source.images || [],
        // Per-lookup-key unit from 1C (a package barcode and the article can
        // report different units for one product).
        unit: stockEntry?.unit || '',
        // Shown after the article on the product sheet.
        barcode: searchType === 'barcode' ? search : '',
    };
};

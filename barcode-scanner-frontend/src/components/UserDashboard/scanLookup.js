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

/**
 * The catalog 404's code. It is the only catalog failure that is a real
 * ANSWER ("this org's replica does not hold that product"). Every other
 * failure — a 500, a network drop — means we could not ask.
 */
export const CATALOG_MISS_CODE = 'PRODUCT_NOT_IN_CATALOG';

/**
 * What the scan established: `'found' | 'not_found' | 'unknown'`.
 *
 * Three values, not two, because "we could not find it" and "we could not
 * ask" must not reach the consultant as the same sentence. The backend keeps
 * `unavailable` and `not_found` apart precisely so nobody hunts a shelf for a
 * product that exists; collapsing them here would undo that on the last hop.
 *
 * - `found`    — the replica answered, or the stock call echoed an identity.
 * - `not_found` — BOTH halves gave a real negative: the catalog 404'd with
 *   `PRODUCT_NOT_IN_CATALOG` and 1C was reached and reported `not_found`.
 * - `unknown`  — nothing renderable and at least one half never answered: a
 *   stock transport failure, `unavailable`, `no_lookup_key`, or a catalog
 *   failure that is not the 404.
 */
export const scanVerdict = ({catalogResult, stockEntry}) => {
    if (catalogResult?.success || stockEntry?.product) return 'found';
    const catalogDefinitelyMissed = catalogResult?.code === CATALOG_MISS_CODE;
    const stockDefinitelyMissed = stockEntry?.status === 'not_found';
    return catalogDefinitelyMissed && stockDefinitelyMissed ? 'not_found' : 'unknown';
};

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

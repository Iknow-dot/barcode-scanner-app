import {firstStockEntry, productInfoFrom, scanVerdict} from './scanLookup';

const OK_STOCK = {success: true, data: {results: [
    {sku: 'A1', status: 'ok', stock: [{warehouse: 'W1', quantity: 3}], unit: 'pcs'},
]}};
const HEALED = {success: true, data: {results: [
    {sku: 'A1', status: 'ok', stock: [], product: {
        sku: 'NOM-9', article: 'A1', sku_name: 'Discovered', price: '5.00', images: ['i0'],
    }},
]}};
const NOT_FOUND_STOCK = {success: true, data: {results: [{sku: 'A1', status: 'not_found', stock: []}]}};
const CATALOG_HIT = {success: true, data: {
    sku: 'NOM-1', article: 'A1', sku_name: 'Held', price: '9.99', images: ['i0'],
}};
const UNAVAILABLE_STOCK = {success: true, data: {results: [{sku: 'A1', status: 'unavailable', stock: []}]}};
const NO_KEY_STOCK = {success: true, data: {results: [{sku: 'A1', status: 'no_lookup_key', stock: []}]}};
const CATALOG_MISS = {success: false, status: 404, code: 'PRODUCT_NOT_IN_CATALOG'};
// Not an answer — the replica was never reached.
const CATALOG_DOWN = {success: false, status: 500, code: null};

describe('firstStockEntry', () => {
    test('pulls the single result out', () => {
        expect(firstStockEntry(OK_STOCK).status).toBe('ok');
    });

    test('a transport failure degrades to unavailable, never to not_found', () => {
        expect(firstStockEntry({success: false, status: null}))
            .toEqual({status: 'unavailable', stock: [], unit: '', product: null});
    });

    test('an empty results list degrades to unavailable', () => {
        expect(firstStockEntry({success: true, data: {results: []}}).status).toBe('unavailable');
    });
});

describe('scanVerdict', () => {
    test('a catalog hit is found even when stock is degraded', () => {
        const entry = firstStockEntry({success: false, status: null});
        expect(scanVerdict({catalogResult: CATALOG_HIT, stockEntry: entry})).toBe('found');
    });

    test('a catalog miss rescued by the self-heal is found', () => {
        expect(scanVerdict({catalogResult: CATALOG_MISS, stockEntry: firstStockEntry(HEALED)}))
            .toBe('found');
    });

    // Both halves gave a real negative answer: the replica 404'd and 1C was
    // reached and said it does not know the product either. Only this is a
    // not-found.
    test('a catalog miss plus a reachable 1C reporting not_found is not found', () => {
        expect(scanVerdict({catalogResult: CATALOG_MISS, stockEntry: firstStockEntry(NOT_FOUND_STOCK)}))
            .toBe('not_found');
    });

    test('a catalog miss plus an unreachable 1C is NOT a not-found', () => {
        const entry = firstStockEntry({success: false, status: null});
        expect(entry.status).toBe('unavailable');
        expect(scanVerdict({catalogResult: CATALOG_MISS, stockEntry: entry})).toBe('unknown');
    });

    test('a catalog miss plus a degraded 1C answer is unknown, not not-found', () => {
        expect(scanVerdict({catalogResult: CATALOG_MISS, stockEntry: firstStockEntry(UNAVAILABLE_STOCK)}))
            .toBe('unknown');
    });

    test('a catalog miss plus a row 1C cannot be asked about is unknown', () => {
        expect(scanVerdict({catalogResult: CATALOG_MISS, stockEntry: firstStockEntry(NO_KEY_STOCK)}))
            .toBe('unknown');
    });

    // The catalog half must be a 404 too. A 500 means we never learned whether
    // the replica holds it, so 1C's not_found cannot settle the question.
    test('a catalog failure that is not the 404 is unknown even when 1C says not_found', () => {
        expect(scanVerdict({catalogResult: CATALOG_DOWN, stockEntry: firstStockEntry(NOT_FOUND_STOCK)}))
            .toBe('unknown');
    });

    test('both halves down is unknown', () => {
        expect(scanVerdict({
            catalogResult: CATALOG_DOWN, stockEntry: firstStockEntry({success: false, status: null}),
        })).toBe('unknown');
    });
});

describe('productInfoFrom', () => {
    test('prefers the catalog row', () => {
        const info = productInfoFrom({
            catalogData: CATALOG_HIT.data, stockEntry: firstStockEntry(OK_STOCK),
            search: '4870001', searchType: 'barcode',
        });
        expect(info.sku_name).toBe('Held');
        expect(info.unit).toBe('pcs');
        expect(info.barcode).toBe('4870001');
    });

    test('falls back to the self-heal echo', () => {
        const info = productInfoFrom({
            catalogData: null, stockEntry: firstStockEntry(HEALED),
            search: 'A1', searchType: 'article',
        });
        expect(info.sku_name).toBe('Discovered');
        expect(info.sku).toBe('NOM-9');
        expect(info.barcode).toBe('');
    });

    test('returns null when neither half knows anything', () => {
        expect(productInfoFrom({
            catalogData: null, stockEntry: firstStockEntry(NOT_FOUND_STOCK),
            search: 'A1', searchType: 'article',
        })).toBeNull();
    });
});

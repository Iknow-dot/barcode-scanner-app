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
const CATALOG_MISS = {success: false, status: 404, code: 'PRODUCT_NOT_IN_CATALOG'};

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

    test('a catalog miss with no identity from 1C is not found', () => {
        expect(scanVerdict({catalogResult: CATALOG_MISS, stockEntry: firstStockEntry(NOT_FOUND_STOCK)}))
            .toBe('not_found');
    });

    // The brief named this case "is NOT a not-found" while asserting
    // 'not_found'. The assertion is the correct half: with the replica missing
    // and 1C unreachable there is no identity to render a card from, so
    // not-found is the only renderable verdict. What must NOT happen is the
    // inverse — a reachable 1C reporting nothing is the only thing that makes
    // a *degraded* stock answer look like a hard 404 (see the assertion below
    // on the entry's status, which stays `unavailable`).
    test('a catalog miss plus an unreachable 1C is a not-found, but the stock half still reads unavailable', () => {
        const entry = firstStockEntry({success: false, status: null});
        expect(entry.status).toBe('unavailable');
        expect(scanVerdict({catalogResult: CATALOG_MISS, stockEntry: entry})).toBe('not_found');
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

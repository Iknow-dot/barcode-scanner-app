import api from '../request';
import API_ENDPOINTS from '../endpoints';
import {searchProduct, fetchStock} from './productService';

jest.mock('../request', () => ({post: jest.fn(() => Promise.resolve({success: true, data: {}}))}));

beforeEach(() => api.post.mockClear());

describe('searchProduct', () => {
    test('omits record_scan unless the lookup was user-started', () => {
        searchProduct({sku: 'A1', searchType: 'article'});
        expect(api.post).toHaveBeenCalledWith(API_ENDPOINTS.product_search, {
            sku: 'A1', is_barcode: false,
        });
    });

    test('a user-started barcode lookup counts as a scan', () => {
        searchProduct({sku: '4870001', searchType: 'barcode', recordScan: true});
        expect(api.post).toHaveBeenCalledWith(API_ENDPOINTS.product_search, {
            sku: '4870001', is_barcode: true, record_scan: true,
        });
    });

    test('no longer sends warehouses or include_images', () => {
        searchProduct({sku: 'A1', searchType: 'article'});
        const [, body] = api.post.mock.calls[0];
        expect(body).not.toHaveProperty('warehouses');
        expect(body).not.toHaveProperty('include_images');
    });
});

describe('fetchStock', () => {
    test('posts the batch to the stock endpoint', () => {
        fetchStock({items: [{sku: 'ART-1', isBarcode: false}], warehouseCodes: ['W1']});
        expect(api.post).toHaveBeenCalledWith(API_ENDPOINTS.product_stock, {
            items: [{sku: 'ART-1', is_barcode: false}],
            warehouses: ['W1'],
        });
    });

    test('sends several SKUs in one request', () => {
        fetchStock({items: [{sku: 'A'}, {sku: 'B'}], warehouseCodes: []});
        expect(api.post).toHaveBeenCalledTimes(1);
        expect(api.post.mock.calls[0][1].items).toEqual([
            {sku: 'A', is_barcode: false},
            {sku: 'B', is_barcode: false},
        ]);
    });

    test('a comma string of warehouse codes is split', () => {
        fetchStock({items: [{sku: 'A'}], warehouseCodes: 'W1, W2'});
        expect(api.post.mock.calls[0][1].warehouses).toEqual(['W1', 'W2']);
    });

    test('an absent warehouse list means all warehouses', () => {
        fetchStock({items: [{sku: 'A'}]});
        expect(api.post.mock.calls[0][1].warehouses).toEqual([]);
    });
});

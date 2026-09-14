import api from '../request';
import API_ENDPOINTS from '../endpoints';
import {searchProduct} from './productService';

jest.mock('../request', () => ({
    __esModule: true,
    default: {post: jest.fn(() => Promise.resolve({success: true, data: {}}))},
}));

describe('searchProduct', () => {
    beforeEach(() => api.post.mockClear());

    test('omits record_scan unless asked, so background lookups are not counted', () => {
        searchProduct({sku: '4000', searchType: 'barcode', warehouseCodes: []});
        expect(api.post).toHaveBeenCalledTimes(1);
        expect(api.post.mock.calls[0][1]).not.toHaveProperty('record_scan');
    });

    test('sends record_scan: true for a user-started lookup', () => {
        searchProduct({sku: '4000', searchType: 'barcode', warehouseCodes: ['W1'], recordScan: true});
        expect(api.post).toHaveBeenCalledWith(API_ENDPOINTS.product_search, {
            sku: '4000',
            is_barcode: true,
            warehouses: ['W1'],
            include_images: true,
            record_scan: true,
        });
    });
});

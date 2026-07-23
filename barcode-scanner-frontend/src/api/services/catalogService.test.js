import client from '../client';
import api from '../request';
import API_ENDPOINTS from '../endpoints';
import { buildImageUrl, catalogService } from './catalogService';

jest.mock('../request', () => ({
  __esModule: true,
  default: { get: jest.fn(() => Promise.resolve({ success: true, data: {} })) },
}));

test('buildImageUrl joins base + proxy path', () => {
  expect(buildImageUrl('http://api.test/api/v1/', 'catalog/products/S1/image/0/'))
    .toBe('http://api.test/api/v1/catalog/products/S1/image/0/');
});

test('imageUrl injects the /api/v1 prefix onto the host base URL', () => {
  const prev = client.defaults.baseURL;
  client.defaults.baseURL = 'http://api.test';
  try {
    expect(catalogService.imageUrl('catalog/products/S1/image/0/'))
      .toBe('http://api.test/api/v1/catalog/products/S1/image/0/');
  } finally {
    client.defaults.baseURL = prev;
  }
});

describe('catalogService admin methods', () => {
  beforeEach(() => api.get.mockClear());

  test('syncStatus hits the sync-status endpoint', () => {
    catalogService.syncStatus();
    expect(api.get).toHaveBeenCalledWith(API_ENDPOINTS.catalogSyncStatus);
  });

  test('listProducts passes params to the list endpoint', () => {
    const params = { page: 2, page_size: 25, q: 'pan', is_active: true };
    catalogService.listProducts(params);
    expect(api.get).toHaveBeenCalledWith(API_ENDPOINTS.catalogProductList, { params });
  });

  test('categoryTree hits the tree endpoint', () => {
    catalogService.categoryTree();
    expect(api.get).toHaveBeenCalledWith(API_ENDPOINTS.catalogCategoryTree);
  });
});

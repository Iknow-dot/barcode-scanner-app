import client from '../client';
import { buildImageUrl, catalogService } from './catalogService';

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

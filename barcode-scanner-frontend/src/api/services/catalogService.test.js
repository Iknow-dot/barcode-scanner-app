import { buildImageUrl } from './catalogService';

test('buildImageUrl joins base + proxy path', () => {
  expect(buildImageUrl('http://api.test/api/v1/', 'catalog/products/S1/image/0/'))
    .toBe('http://api.test/api/v1/catalog/products/S1/image/0/');
});

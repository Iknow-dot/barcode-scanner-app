import crypto from 'k6/crypto';
import { SECRET_KEY } from './config.js';

export const PATHS = {
  login: '/api/v1/users/auth/login/',
  refresh: '/api/v1/users/auth/refresh/',
  productSearch: '/api/v1/product/search/',
  catalogSearch: '/api/v1/catalog/products/search/',
  catalogList: '/api/v1/catalog/products/list/',
  categoryTree: '/api/v1/catalog/categories/tree/',
  syncStatus: '/api/v1/catalog/sync-status/',
  orders: '/api/v1/orders/',
  analytics: '/api/v1/analytics/orders/',
  catalogIngest: '/api/v1/catalog/products/',
  warehouses: '/api/v1/warehouses/',
};

// Mirrors core/catalog/image_urls.py: HMAC-SHA256 over "org:sku:idx" keyed by
// SECRET_KEY, truncated to 32 hex chars. The frontend must never rebuild these
// — but a load test has to, because there is no page to scrape them from.
export function signedImagePath(orgId, sku, idx) {
  const sig = crypto.hmac('sha256', SECRET_KEY, `${orgId}:${sku}:${idx}`, 'hex').slice(0, 32);
  return `/api/v1/catalog/products/${sku}/image/${idx}/?org=${orgId}&sig=${sig}`;
}

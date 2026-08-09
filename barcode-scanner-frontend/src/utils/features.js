/**
 * Org-level feature flags carried on the login payload (authData).
 *
 * The backend gates the corresponding endpoints too (403 CATALOG_NOT_ENABLED)
 * — these helpers only decide what UI to render, they are not the security
 * boundary. A flag changed by an internal admin reaches the user on their
 * next login, same as gift_marking_enabled.
 */
export const catalogFeatureEnabled = (authData) => !!authData?.product_catalog_enabled;

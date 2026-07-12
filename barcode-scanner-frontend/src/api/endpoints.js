const API_ENDPOINTS = {
    ip: "api/v1/users/ip/",
    users: "api/v1/users/",
    edit_user: userId => `api/v1/users/${userId}/`,
    delete_user: userId => `api/v1/users/${userId}/`,
    auth: {
        login: "api/v1/users/auth/login/",
        logout: "api/v1/users/auth/logout/",
        refresh: "api/v1/users/auth/refresh/",
        verify: "api/v1/users/auth/verify/",
    },
    organizations: "api/v1/organizations/",
    organization: orgId => `api/v1/organizations/${orgId}/`,
    organization_used_ips: orgId => `api/v1/organizations/${orgId}/used-ips/`,
    my_organization: "api/v1/organizations/my-organization/",
    my_organization_external_service: "api/v1/organizations/my-organization/external-service/",
    my_organization_invoice_template: "api/v1/organizations/my-organization/invoice-template/",
    warehouses: "api/v1/warehouses/",
    warehouse: warehouseId => `api/v1/warehouses/${warehouseId}/`,
    product_search: "api/v1/product/search/",
    catalogProductSearch: "api/v1/catalog/products/search/",

    // Clients (1C ConsultWebExchange)
    client_check: "api/v1/clients/check/",
    client_create: "api/v1/clients/create/",
    rs_ge_lookup: "api/v1/clients/rs-ge-lookup/",
    client_reverse_geocode: "api/v1/clients/reverse-geocode/",
    client_search_addresses: "api/v1/clients/search-addresses/",

    // Purchase Orders
    orders: "api/v1/orders/",
    order: orderId => `api/v1/orders/${orderId}/`,
    order_items: orderId => `api/v1/orders/${orderId}/items/`,
    order_item: (orderId, itemId) => `api/v1/orders/${orderId}/items/${itemId}/`,
    order_item_update: (orderId, itemId) => `api/v1/orders/${orderId}/items/${itemId}/update/`,
    order_items_bulk_update: orderId => `api/v1/orders/${orderId}/items/bulk-update/`,
    order_invoice: orderId => `api/v1/orders/${orderId}/invoice/`,
    order_invoice_preview: orderId => `api/v1/orders/${orderId}/invoice-preview/`,
    invoice_tokens: "api/v1/invoice-tokens/",
    invoice_token_sample_values: "api/v1/invoice-tokens/sample-values/",
    analytics_orders: "api/v1/analytics/orders/",
};

export default API_ENDPOINTS;

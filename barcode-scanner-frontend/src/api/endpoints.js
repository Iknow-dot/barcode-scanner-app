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
    warehouses: "api/v1/warehouses/",
    warehouse: warehouseId => `api/v1/warehouses/${warehouseId}/`,
    product_search: "api/v1/product/search/",

    // Customers
    customers: "api/v1/customers/",
    customer: customerId => `api/v1/customers/${customerId}/`,
    rs_ge_lookup: "api/v1/customers/rs-ge-lookup/",

    // Purchase Orders
    orders: "api/v1/orders/",
    order: orderId => `api/v1/orders/${orderId}/`,
    order_items: orderId => `api/v1/orders/${orderId}/items/`,
    order_item: (orderId, itemId) => `api/v1/orders/${orderId}/items/${itemId}/`,
    order_item_update: (orderId, itemId) => `api/v1/orders/${orderId}/items/${itemId}/update/`,
};

export default API_ENDPOINTS;

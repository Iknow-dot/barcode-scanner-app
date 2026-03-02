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
    my_organization: "api/v1/organizations/my-organization/",
    warehouses: "api/v1/warehouses/",
    warehouse: warehouseId => `api/v1/warehouses/${warehouseId}/`,
    product_search: "api/v1/product/search/",
};

export default API_ENDPOINTS;

import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:5000', // Your Flask backend URL
});

export const getOrganizations = () => api.get('/organizations');
export const getWarehouses = () => api.get('/warehouses');
export const createOrganization = (data) => api.post('/organizations', data);
export const createWarehouse = (data) => api.post('/warehouses', data);
export const loginUser = (credentials) => api.post('/auth/login', credentials);
export const logoutUser = () => api.post('/auth/logout');

export default api;

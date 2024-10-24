import axios from 'axios';

// Set up the base URL for the API
const api = axios.create({
  baseURL: 'http://127.0.0.1:5000',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add a request interceptor to include JWT token in all requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Handle refresh token and unauthorized requests
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshResponse = await api.post('/auth/token/refresh');
        const newToken = refreshResponse.data.access_token;

        // Store the new token and retry the request with updated token
        localStorage.setItem('token', newToken);
        originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        // Redirect to login if refresh fails
        localStorage.removeItem('token');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Function to call the scan API endpoint
export const scanProducts = async (barcode, searchType, warehouseCodes) => {
  try {
    console.log("API Call - Payload:", { barcode, searchType, warehouseCodes });  // Debug log to inspect payload
    const response = await api.post('/products/scan', {
      barcode,
      searchType,
      warehouseCodes
    });
    return response.data;  // Assuming the response includes the data you need
  } catch (error) {
    console.error("Error during product scan:", error);
    throw error;
  }
};

// Function to get user-specific warehouses
export const getUserWarehouses = async () => {
  try {
    const response = await api.get('/user-warehouses/user');  // Call to the new route
    return response.data;  // Return the list of warehouses associated with the user
  } catch (error) {
    console.error("Error fetching user warehouses:", error);
    throw error;
  }
};

export default api;

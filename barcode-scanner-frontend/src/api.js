import axios from 'axios';


console.debug(process.env);
// Set up the base URL for the API
const api = axios.create({
  baseURL: process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add a request interceptor to include JWT token in all requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

// Handle refresh token and unauthorized requests
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    // console.log("Interceptor caught error:", error.response?.status);

    // Check if the error is 401 and it is not a retry of a token refresh request
    if (error.response?.status === 401 && !originalRequest._retry && originalRequest.url !== '/auth/token/refresh') {
      // console.log("Attempting to refresh token");
      originalRequest._retry = true; // mark this request as already retried

      try {
        const refreshResponse = await api.post('/auth/token/refresh');
        const newToken = refreshResponse.data.access_token;

        // Store the new token and retry the request with updated token
        localStorage.setItem('token', newToken);
        originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        // console.log("Refresh token attempt failed:", refreshError);
        // Redirect to login if refresh fails
        localStorage.removeItem('token');
        // window.location.href = '/login';
        return Promise.reject(refreshError); // stop further processing
      }
    }

    return Promise.reject(error);
  }
);

// Export API methods
export const scanProducts = async (barcode, searchType, warehouseCodes) => {
  try {
    const response = await api.post('/products/scan', {
      barcode,
      searchType,
      warehouseCodes
    });
    return response.data;
  } catch (error) {
    console.error("Error during product scan:", error);
    throw error;
  }
};

export const getUserWarehouses = async () => {
  try {
    const response = await api.get('/user-warehouses/user');
    return response.data;
  } catch (error) {
    console.error("Error fetching user warehouses:", error);
    throw error;
  }
};

export const getUserWarehousesByUserId = async (userId) => {
  try {
    const response = await api.get(`/user_warehouses/${userId}`);
    return response.data;
  } catch (error) {
    console.error("Error fetching user warehouses:", error);
    throw error;
  }
};

export const processBarcode = async (file) => {
  try {
    // Create an instance of FormData
    const formData = new FormData();
    formData.append('file', file);

    // Make the POST request to the process_barcode endpoint
    const response = await api.post('/process_barcode', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    return response.data;
  } catch (error) {
    console.error("Error processing barcode:", error);
    throw error;
  }
};

export const fetchImageThroughProxy = async (url) => {
  try {
    const response = await api.get('/proxy', {
      params: { url },
    });
    return response.data;
  } catch (error) {
    console.error("Error fetching image through proxy:", error);
    throw error;
  }
};

export const getClientIp = async () => {
  try {
    const response = await api.get('/get-client-ip');
    // Success case, returning the IP directly or wrapped in an object if you prefer to standardize response structures
    return { success: true, ip: response.data };
  } catch (error) {
    console.error("Error fetching client IP:", error);
    // Handling specific errors can help in debugging and user feedback
    if (!error.response) {
      // Network error or request was not made
      return { success: false, message: "Network error or no response from server." };
    } else {
      // API responded with an error status code
      return {
        success: false,
        message: "Failed to fetch IP address",
        errorCode: error.response.status,
        errorDescription: error.response.data.error || 'An unknown error occurred'
      };
    }
  }
};

export default api;
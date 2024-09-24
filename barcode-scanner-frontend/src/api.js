import axios from 'axios';

// Set up the base URL for the API
const api = axios.create({
  baseURL: 'http://127.0.0.1:5000',  // Ensure the base URL matches your Flask backend
  headers: {
    'Content-Type': 'application/json',  // Default content type for all requests
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
  (error) => {
    return Promise.reject(error);
  }
);

// Handle refresh token and unauthorized requests
api.interceptors.response.use(
  (response) => response,  // Return response normally if successful
  async (error) => {
    const originalRequest = error.config;

    // Check if error status is 401 (Unauthorized) and if the request hasn't been retried
    if (error.response.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;  // Set retry flag to prevent infinite loop

      try {
        // Attempt to refresh the token
        const refreshResponse = await api.post('/auth/token/refresh');
        const newToken = refreshResponse.data.access_token;

        // Store the new token and update the original request headers
        localStorage.setItem('token', newToken);
        originalRequest.headers['Authorization'] = `Bearer ${newToken}`;

        // Retry the original request with the new token
        return api(originalRequest);
      } catch (refreshError) {
        // If token refresh fails, clear token and redirect to login
        localStorage.removeItem('token');
        window.location.href = '/login';  // Redirect to login page
      }
    }
    return Promise.reject(error);
  }
);

// Export the Axios instance for use in the rest of the app
export default api;

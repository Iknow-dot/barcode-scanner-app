import axios from 'axios';
import API_ENDPOINTS from './endpoints';

// Set up the base URL for the API
const client = axios.create({
    baseURL: process.env.REACT_APP_API_BASE_URL || "http://localhost:8000",
    headers: {
        'Content-Type': 'application/json',
    },
});

// Add a request interceptor to include JWT token in all requests
client.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
}, (error) => {
    return Promise.reject(error);
});

// Handle refresh token and unauthorized requests
client.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        // Check if the error is 401 and it is not a retry of a token refresh request
        if (
            error.response?.status === 401 &&
            !originalRequest._retry &&
            originalRequest.url !== API_ENDPOINTS.auth.refresh &&
            originalRequest.url !== API_ENDPOINTS.auth.login
        ) {
            originalRequest._retry = true;

            const refreshToken = localStorage.getItem('refresh_token');
            if (!refreshToken) {
                // No refresh token available, redirect to login
                localStorage.removeItem('token');
                localStorage.removeItem('refresh_token');
                window.location.href = '/login';
                return Promise.reject(error);
            }

            try {
                const refreshResponse = await client.post(API_ENDPOINTS.auth.refresh, {
                    refresh: refreshToken,
                });
                const newAccessToken = refreshResponse.data.access;

                // Store the new token and retry the request with updated token
                localStorage.setItem('token', newAccessToken);

                // Rotation is on server-side: each refresh returns a NEW
                // refresh token and blacklists the old one — persist it or
                // the next silent refresh 401s and force-logs the user out.
                if (refreshResponse.data.refresh) {
                    localStorage.setItem('refresh_token', refreshResponse.data.refresh);
                }
                originalRequest.headers['Authorization'] = `Bearer ${newAccessToken}`;
                return client(originalRequest);
            } catch (refreshError) {
                // Redirect to login if refresh fails
                localStorage.removeItem('token');
                localStorage.removeItem('refresh_token');
                window.location.href = '/login';
                return Promise.reject(refreshError);
            }
        }

        return Promise.reject(error);
    }
);

export default client;

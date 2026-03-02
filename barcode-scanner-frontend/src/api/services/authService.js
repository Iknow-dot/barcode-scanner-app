import api from '../request';
import client from '../client';
import API_ENDPOINTS from '../endpoints';

/**
 * Login with username and password.
 * Returns the full auth payload from Django SimpleJWT custom serializer.
 *
 * @param {string} username
 * @param {string} password
 */
export const login = (username, password) =>
    api.post(API_ENDPOINTS.auth.login, { username, password });

/**
 * Logout by blacklisting the refresh token.
 *
 * @param {string} refreshToken
 */
export const logout = (refreshToken) =>
    api.post(API_ENDPOINTS.auth.logout, { refresh: refreshToken });

/**
 * Set the Authorization header on the shared axios client.
 * Call this after login to ensure subsequent requests are authenticated.
 *
 * @param {string} token - JWT access token
 */
export const setAuthToken = (token) => {
    client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
};

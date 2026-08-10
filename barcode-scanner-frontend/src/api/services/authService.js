import api from '../request';
import client from '../client';
import API_ENDPOINTS from '../endpoints';
import {getStoredDeviceId, storeDeviceId} from '../../utils/deviceId';

/**
 * Login with username and password.
 * Returns the full auth payload from Django SimpleJWT custom serializer.
 *
 * Sends the stored device ID (device lock) when present and persists the
 * one the backend issues/echoes on success.
 *
 * @param {string} username
 * @param {string} password
 */
export const login = async (username, password) => {
    const deviceId = getStoredDeviceId();
    const payload = deviceId
        ? {username, password, device_id: deviceId}
        : {username, password};
    const result = await api.post(API_ENDPOINTS.auth.login, payload);
    if (result.success && result.data?.device_id) {
        storeDeviceId(result.data.device_id);
    }
    return result;
};

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

// Device identity for the per-user device lock (backend-issued on first
// locked login). Lives under its own key so auth cleanup — which removes
// named token/auth keys only — never deletes it: the ID must survive
// logout, otherwise every re-login would be rejected as a new device.
const DEVICE_ID_KEY = 'device_id';

export const getStoredDeviceId = () => {
    try {
        return window.localStorage.getItem(DEVICE_ID_KEY) || null;
    } catch (e) {
        return null;
    }
};

export const storeDeviceId = (deviceId) => {
    if (!deviceId) return;
    try {
        window.localStorage.setItem(DEVICE_ID_KEY, deviceId);
    } catch (e) {
        // Storage unavailable (private mode) — next login will just re-present nothing.
    }
};

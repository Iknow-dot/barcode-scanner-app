/**
 * The message the login form shows for a failed attempt. Backend errors are
 * translated by their `code`, never their `detail` text.
 *
 * @param {{code?: string|null, error?: string, data?: object}} result - from api/request.js
 * @param {object} t - translations bundle (from useLanguage())
 */
export default function loginErrorMessage(result, t) {
    switch (result.code) {
        case 'IP_NOT_ALLOWED':
            return t.ipNotAllowed;
        case 'DEVICE_NOT_ALLOWED':
            return t.deviceNotAllowed;
        case 'LOGIN_THROTTLED': {
            const seconds = Number(result.data?.retry_after) || 0;
            return t.loginThrottled(Math.max(1, Math.ceil(seconds / 60)));
        }
        default:
            return result.error || t.invalidCredentials;
    }
}

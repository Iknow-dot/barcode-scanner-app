// Django's password-validator codes → translation keys. The backend sends
// the codes as `reasons` in a WEAK_PASSWORD envelope under `password`.
const REASON_KEYS = {
    password_too_short: 'passwordMinLength',
    password_too_common: 'passwordTooCommon',
    password_entirely_numeric: 'passwordEntirelyNumeric',
    password_too_similar: 'passwordTooSimilar',
};

/**
 * Translated text for a users-API rejection of a weak password, or null when
 * the failure is something else. A reason with no translation falls back to
 * the backend's own (English) text rather than hiding it.
 *
 * @param {{data?: object}} result - from api/request.js
 * @param {object} t - translations bundle (from useLanguage())
 */
export default function weakPasswordMessage(result, t) {
    const error = result?.data?.password;
    if (!error || error.code !== 'WEAK_PASSWORD') return null;
    const messages = (error.reasons || []).map((code) => t[REASON_KEYS[code]]);
    if (!messages.length || messages.some((message) => !message)) {
        return error.detail || null;
    }
    return messages.join(' ');
}

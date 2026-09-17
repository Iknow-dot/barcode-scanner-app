// Maps a backend error `code` to the i18n key used to translate it, shared by
// the lookup step (ClientLookupSheet.js) and the create step
// (ClientCreateForm.js) so a client-facing error reads the same regardless of
// which step raised it.
export const ERROR_CODE_MESSAGES = {
    CLIENT_CREATE_UNVERIFIED: 'clientCreateUnverified',
    EXTERNAL_SERVICE_TIMEOUT: 'externalServiceTimeout',
    EXTERNAL_SERVICE_UNAVAILABLE: 'externalServiceUnavailable',
    EXTERNAL_SERVICE_UNAUTHORIZED: 'externalServiceUnauthorized',
    EXTERNAL_SERVICE_ERROR: 'externalServiceError',
    CLIENT_ALREADY_EXISTS: 'clientAlreadyExists',
};

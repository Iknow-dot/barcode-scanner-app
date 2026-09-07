/**
 * Was a failed client registration maybe still committed upstream?
 *
 * CreateClient is a non-idempotent write. When the platform router in front of
 * the API abandons the request (60s on DigitalOcean App Platform, answered with
 * its own 502 HTML page), our backend's own verification never reaches the
 * browser — so the decision has to be repeated here.
 *
 * A failure carrying one of our error codes is a definite answer from the API:
 * the write did not land (or CLIENT_ALREADY_EXISTS, which is its own message).
 * Anything else — a gateway page, a 5xx, an aborted or offline request — is
 * indeterminate, and the client may well exist.
 */

// The backend's own answer when it could not confirm either way.
export const UNVERIFIED_CODE = 'CLIENT_CREATE_UNVERIFIED';

export const isIndeterminateFailure = (result) => {
    if (!result || result.success) return false;
    if (result.code === UNVERIFIED_CODE) return true;
    // Any other coded envelope is the API speaking: it knows the create failed.
    if (result.code) return false;
    // No code: a gateway/proxy page, an unhandled 5xx, or no response at all.
    return result.status === null || result.status === undefined || result.status >= 500;
};

/** The lookup key CheckClient can search by, or '' when we have none. */
export const lookupKeyFor = (payload = {}) => (
    (payload.identification_number || '').trim() || (payload.phone || '').trim()
);

/**
 * Resolve an indeterminate create by asking whether the client is there now.
 *
 * `checkClient` is injected (clientService.checkClient) and `delay` lets the
 * caller wait between attempts: when the browser gave up before the server did,
 * the upstream write can still be in flight, so a single immediate "not found"
 * is not proof of absence.
 *
 * Resolves to {found: client} | {found: null, checked: true} | {found: null, checked: false}.
 */
export const recoverCreatedClient = async (
    payload, checkClient, {attempts = 2, delay = () => Promise.resolve()} = {},
) => {
    const key = lookupKeyFor(payload);
    if (!key) return {found: null, checked: false};

    let checked = false;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (attempt > 0) await delay();
        // eslint-disable-next-line no-await-in-loop
        const result = await checkClient({
            identification_number: payload.identification_number || '',
            phone: payload.phone || '',
        });
        if (result.success) {
            const client = (result.data?.clients || [])[0];
            if (client) return {found: client, checked: true};
            checked = true;
        } else if (result.code === 'CLIENT_NOT_FOUND') {
            checked = true;
        }
        // Any other failure leaves `checked` false: we still cannot tell.
    }
    return {found: null, checked};
};

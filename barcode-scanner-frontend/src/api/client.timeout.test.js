import client, {REQUEST_TIMEOUT_MS} from './client';

describe('axios request cap', () => {
    it('gives up before the platform router does', () => {
        // The router abandons a request at 60s and answers with its own HTML
        // error page, which tells the user nothing and hides that the request
        // may have been processed anyway. Losing that race on purpose keeps
        // failures inside our own error handling.
        expect(REQUEST_TIMEOUT_MS).toBeLessThan(60000);
        expect(client.defaults.timeout).toBe(REQUEST_TIMEOUT_MS);
    });
});

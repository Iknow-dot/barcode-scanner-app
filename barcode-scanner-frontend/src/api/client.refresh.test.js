import client from './client';
import API_ENDPOINTS from './endpoints';

describe('401 refresh interceptor', () => {
    afterEach(() => {
        localStorage.clear();
    });

    it('stores the rotated refresh token so the next refresh does not reuse a blacklisted one', async () => {
        localStorage.setItem('token', 'stale-access');
        localStorage.setItem('refresh_token', 'old-refresh');

        client.defaults.adapter = (config) =>
            Promise.resolve({
                data: config.url === API_ENDPOINTS.auth.refresh
                    ? {access: 'new-access', refresh: 'new-refresh'}
                    : {},
                status: 200,
                statusText: 'OK',
                headers: {},
                config,
            });

        const onRejected = client.interceptors.response.handlers[0].rejected;
        await onRejected({
            config: {url: '/api/v1/orders/', headers: {}},
            response: {status: 401},
        });

        expect(localStorage.getItem('token')).toBe('new-access');
        expect(localStorage.getItem('refresh_token')).toBe('new-refresh');
    });
});

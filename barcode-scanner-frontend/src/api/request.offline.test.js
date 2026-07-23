jest.mock('./client', () => ({
    __esModule: true,
    default: {get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn()},
}));

import {apiRequest} from './request';
import {isOffline, markOnline} from '../utils/connectivity';

beforeEach(() => {
    markOnline();
});

test('network error (no response) marks connectivity offline', async () => {
    const result = await apiRequest(() => Promise.reject(new Error('Network Error')));
    expect(result.success).toBe(false);
    expect(result.status).toBeNull();
    expect(isOffline()).toBe(true);
});

test('HTTP error (has response) does not mark offline', async () => {
    const err = new Error('Bad Request');
    err.response = {status: 400, data: {detail: 'bad'}};
    const result = await apiRequest(() => Promise.reject(err));
    expect(result.status).toBe(400);
    expect(isOffline()).toBe(false);
});

test('successful request marks connectivity online', async () => {
    // First go offline via a network error, then recover.
    await apiRequest(() => Promise.reject(new Error('Network Error')));
    expect(isOffline()).toBe(true);
    const result = await apiRequest(() => Promise.resolve({data: {ok: true}, status: 200}));
    expect(result.success).toBe(true);
    expect(isOffline()).toBe(false);
});

import {runtimeEnv} from './runtimeEnv';

describe('runtimeEnv', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = {...originalEnv, REACT_APP_API_BASE_URL: 'http://build-time.example'};
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('falls back to the build-time values when no runtime config is loaded', () => {
        expect(runtimeEnv({}).REACT_APP_API_BASE_URL).toBe('http://build-time.example');
    });

    it('lets the runtime config override a build-time value', () => {
        const win = {__APP_CONFIG__: {REACT_APP_API_BASE_URL: 'https://scanner.customer.example'}};

        expect(runtimeEnv(win).REACT_APP_API_BASE_URL).toBe('https://scanner.customer.example');
    });

    it('adds keys that only exist at runtime', () => {
        const win = {__APP_CONFIG__: {REACT_APP_SENTRY_DSN: 'https://key@o0.ingest.example/1'}};

        expect(runtimeEnv(win).REACT_APP_SENTRY_DSN).toBe('https://key@o0.ingest.example/1');
    });

    it('ignores blank runtime values instead of erasing the build-time one', () => {
        const win = {__APP_CONFIG__: {REACT_APP_API_BASE_URL: ''}};

        expect(runtimeEnv(win).REACT_APP_API_BASE_URL).toBe('http://build-time.example');
    });

    it('does not mutate process.env', () => {
        runtimeEnv({__APP_CONFIG__: {REACT_APP_PUBLIC_POSTHOG_KEY: 'phc_x'}});

        expect(process.env.REACT_APP_PUBLIC_POSTHOG_KEY).toBeUndefined();
    });
});

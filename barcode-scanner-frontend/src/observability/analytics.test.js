import posthog from 'posthog-js';
import {identifyUser, initAnalytics, resetAnalyticsForTests, resetUser} from './analytics';

jest.mock('posthog-js', () => ({
    init: jest.fn(),
    identify: jest.fn(),
    reset: jest.fn(),
}));

describe('analytics', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetAnalyticsForTests();
    });

    it('does not initialize PostHog without a project key', () => {
        expect(initAnalytics({})).toBe(false);
        expect(posthog.init).not.toHaveBeenCalled();
    });

    it('makes no PostHog calls when it was never initialized', () => {
        initAnalytics({REACT_APP_PUBLIC_POSTHOG_KEY: ''});

        identifyUser('u', {role: 'company_user'});
        resetUser();

        expect(posthog.identify).not.toHaveBeenCalled();
        expect(posthog.reset).not.toHaveBeenCalled();
    });

    it('initializes with the configured key and host', () => {
        expect(initAnalytics({
            REACT_APP_PUBLIC_POSTHOG_KEY: 'phc_test',
            REACT_APP_PUBLIC_POSTHOG_HOST: 'https://eu.i.posthog.com',
        })).toBe(true);

        expect(posthog.init).toHaveBeenCalledWith('phc_test', expect.objectContaining({
            api_host: 'https://eu.i.posthog.com',
        }));
    });

    it('forwards identify and reset once initialized', () => {
        initAnalytics({REACT_APP_PUBLIC_POSTHOG_KEY: 'phc_test'});

        identifyUser('u', {role: 'company_user'});
        resetUser();

        expect(posthog.identify).toHaveBeenCalledWith('u', {role: 'company_user'});
        expect(posthog.reset).toHaveBeenCalled();
    });
});

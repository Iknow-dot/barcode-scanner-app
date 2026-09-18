/**
 * PostHog, switched off entirely when no project key is configured.
 *
 * An install without `REACT_APP_PUBLIC_POSTHOG_KEY` must make no PostHog calls
 * at all. Calling `posthog.identify` or `posthog.reset` on a client that was
 * never initialized does not throw, but it logs "You must initialize PostHog"
 * on every login and page load, so callers go through these wrappers instead
 * of importing posthog-js directly.
 */
import posthog from 'posthog-js';

let enabled = false;

export function initAnalytics(env) {
    const key = env.REACT_APP_PUBLIC_POSTHOG_KEY;
    if (!key) {
        return false;
    }
    posthog.init(key, {
        api_host: env.REACT_APP_PUBLIC_POSTHOG_HOST,
        defaults: '2025-12-24',
    });
    enabled = true;
    return true;
}

export function identifyUser(distinctId, properties) {
    if (enabled) {
        posthog.identify(distinctId, properties);
    }
}

export function resetUser() {
    if (enabled) {
        posthog.reset();
    }
}

/** Test seam: forget a previous `initAnalytics` call. */
export function resetAnalyticsForTests() {
    enabled = false;
}

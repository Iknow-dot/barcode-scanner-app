/**
 * The `Sentry.init` options, built in one place so they can be tested.
 *
 * `src/index.js` has module-level side effects (it mounts the app), so the
 * options cannot be asserted on from there. The frontend mirror of the
 * backend's resolved-options tripwire lives in `sentryOptions.test.js` and
 * needs this seam to exist.
 */
import * as Sentry from '@sentry/react';
import {scrubEvent} from './scrub';

/**
 * Every `dataCollection` category, enumerated.
 *
 * This is not verbosity. In `@sentry/core`'s `resolveDataCollectionOptions`,
 * supplying *any* `dataCollection` object swaps the base table from the
 * deny-listed "PII off" defaults to the fully permissive `DEFAULTS`; only the
 * keys actually written are then overridden. A partial block therefore
 * resolves **more permissively than omitting the option entirely** —
 * `urlQueryParams`, `cookies`, `httpHeaders` and `databaseQueryData` would all
 * flip to collect-everything, the exact inverse of this app's guarantee. Add a
 * key here whenever the SDK adds a category.
 *
 * `graphQL` and `stackFrameVariables` are off even though the SDK's own
 * PII-off baseline leaves them on: we run no GraphQL, and
 * `stackFrameVariables` is the browser counterpart of the backend's
 * `include_local_variables=False`, which is load-bearing there.
 * `frameContextLines` is deliberately not set — it is a count of *source*
 * lines, not user data, and both bases supply a sane value.
 */
export const SENTRY_DATA_COLLECTION = {
    userInfo: false,
    cookies: false,
    httpHeaders: {request: false, response: false},
    httpBodies: [],
    urlQueryParams: false,
    graphQL: {document: false, variables: false},
    genAI: {inputs: false, outputs: false},
    databaseQueryData: false,
    stackFrameVariables: false,
};

export function buildSentryOptions(env = process.env) {
    return {
        dsn: env.REACT_APP_SENTRY_DSN,
        environment: env.REACT_APP_SENTRY_ENVIRONMENT || 'production',
        release: env.REACT_APP_SENTRY_RELEASE || undefined,
        integrations: [Sentry.browserTracingIntegration()],
        tracesSampleRate: Number(env.REACT_APP_SENTRY_TRACES_SAMPLE_RATE || 0.05),
        // Scoped to our own API so trace headers never reach Photon or RS.ge.
        tracePropagationTargets: [env.REACT_APP_API_BASE_URL || 'http://localhost:8000'],
        // @sentry/react v10 deprecated sendDefaultPii for dataCollection. The
        // backend is on sentry-sdk 2.x, where send_default_pii is still the
        // live option — the two configs look different because the SDK
        // versions differ, not because the intent does. Do not "fix" this.
        dataCollection: SENTRY_DATA_COLLECTION,
        // Both hooks, not just the first: beforeSend runs on error events
        // alone, and fetch/XHR spans carry the query string on transactions.
        beforeSend: scrubEvent,
        beforeSendTransaction: scrubEvent,
    };
}

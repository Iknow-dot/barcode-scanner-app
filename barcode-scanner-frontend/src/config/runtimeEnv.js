/**
 * The environment the app reads its settings from.
 *
 * Two layers, the second winning:
 *
 * 1. `process.env` — the `REACT_APP_*` values CRA inlines when it compiles.
 *    This is all `npm start` and jest ever see.
 * 2. `window.__APP_CONFIG__` — defined by `public/config.js`, which the
 *    production image rewrites from its container environment at start-up
 *    (`docker/runtime-config.sh`). This layer is what lets one release image
 *    serve every install: a value baked in at build time would pin the API
 *    URL, Sentry DSN and PostHog key of whoever built it.
 *
 * Empty strings in the runtime layer are skipped, so an install that leaves a
 * variable blank falls back to the build-time value rather than erasing it.
 */
export function runtimeEnv(win = typeof window === 'undefined' ? undefined : window) {
    const runtime = (win && win.__APP_CONFIG__) || {};
    const merged = {...process.env};
    Object.entries(runtime).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            merged[key] = value;
        }
    });
    return merged;
}

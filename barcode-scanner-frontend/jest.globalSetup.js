/**
 * Pin the time zone for the whole Jest run.
 *
 * The orders list buckets by the *viewer's local calendar day* and renders a
 * local clock time, so its tests assert local-time results and are only
 * deterministic in a known zone. CI runs in UTC while a developer here runs in
 * Tbilisi (UTC+4), which is a four-hour difference and enough to move an order
 * between day groups.
 *
 * This has to happen before Node resolves the zone: setting `process.env.TZ`
 * inside a `beforeAll` is too late — the first Date the test environment
 * creates fixes the zone, and the later assignment is silently ignored. That
 * mistake shipped once: the suite passed locally (Tbilisi) and failed in CI.
 *
 * globalSetup runs in the parent process before any worker is forked, and
 * workers inherit this env, so it applies to every test file.
 */
module.exports = () => {
    process.env.TZ = 'Asia/Tbilisi';
};

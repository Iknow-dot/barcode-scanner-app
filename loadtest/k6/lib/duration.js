// Small shared duration-string parser + formatter. Exists so a scenario that
// needs to derive its own startTime/duration offsets from a configured
// window (RULING R7 — offsets computed from the configured duration, never
// hard-coded, so a shorter window genuinely shortens the run) doesn't have
// to reinvent this a third time. entry/sweep.js independently implements the
// same parseDurationMs/startTimeAt pattern (predates this file, and is left
// as-is here — refactoring a file outside this dispatch's own task scope
// isn't worth the churn); ceiling.js's opt-in ingest scenario and
// failure.js's mode windows both import from here instead of copying
// sweep.js's private copy a second and third time.
//
// Minimal parser for the k6 duration strings this suite actually produces
// (e.g. '40s', '90s', '1m', '1m30s', '500ms', '3m') — not a general
// Go-duration parser.
export function parseDurationMs(duration) {
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  let match;
  let totalMs = 0;
  let matched = false;
  while ((match = re.exec(duration)) !== null) {
    matched = true;
    const value = Number(match[1]);
    const multiplier = { ms: 1, s: 1000, m: 60000, h: 3600000 }[match[2]];
    totalMs += value * multiplier;
  }
  if (!matched) {
    throw new Error(`duration.js: cannot parse duration="${duration}"`);
  }
  return totalMs;
}

// Formats a millisecond count back into a k6-acceptable duration string.
// Whole seconds only — good enough for the offsets this suite computes; k6
// accepts fractional/sub-second forms too, but nothing here needs them.
export function msToDuration(ms) {
  return `${Math.max(0, Math.round(ms / 1000))}s`;
}

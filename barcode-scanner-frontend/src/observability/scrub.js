/**
 * Egress scrubbing for Sentry events, mirroring backend/backend/sentry.py.
 *
 * The duplication across two languages is unavoidable; the mitigation is
 * that both sides are tested against the same case table. If you change a
 * pattern or a key here, change it there too.
 */

export const REDACTED = '[Filtered]';

// Bounded exact lengths, so an EAN-13 (13 digits) and an EAN-8 (8 digits)
// both pass through untouched.
//
// The phone entry is bounded on the left by `(^|\D)` rather than `\b`, because
// `\b` before an optional `+` does not match at the start of "+995...". Without
// that left bound it matches the *tail* of a longer digit run — "8995123456789"
// would become "8[Filtered]". The captured left char is restored by `$1`.
// Deliberately not a lookbehind: that is ES2018 and absent before Safari 16.4,
// and these handsets are not guaranteed current.
const TEXT_PATTERNS = [
  [/(^|\D)(\+?995\d{9})\b/g, `$1${REDACTED}`],  // Georgian phone
  [/\b\d{11}\b/g, REDACTED],                    // Georgian personal identification number
  [/\b\d{9}\b/g, REDACTED],                     // Georgian legal-entity identification number
];

// Mirrors core/log_redaction.py SENSITIVE_KEYS. Covers both our field names
// and the 1C wire names, since upstream error bodies echo payloads back.
const SENSITIVE_KEYS = new Set([
  'address', 'address_line', 'clientidphone', 'email', 'first_name',
  'full_name', 'fullname', 'identcode', 'identification_number', 'idphone',
  'last_name', 'name', 'personal_number', 'phone', 'phone1', 'phone2',
  'phone_1', 'phone_2', 'registeredsubject',
]);

// Keys whose value *is* a raw query string or fragment. URL metadata is a
// distinct concern from the person-identifying names above, so it is its own
// set — mirroring `_QUERY_KEYS` in backend/backend/sentry.py.
//
// `@sentry/core/fetch.js` puts the query in four places on every fetch/XHR
// span, and spans ride on transactions, which only `beforeSendTransaction`
// sees. Redacting by key covers spans, breadcrumbs and anything the SDK adds
// later, from a single rule that both hooks share.
const QUERY_KEYS = new Set(['http.query', 'url.query', 'http.fragment', 'query_string']);

// Keys holding a full URL: keep scheme, host and path, drop the query.
const URL_KEYS = new Set(['url', 'url.full', 'http.url']);

// Sentry protocol metadata, not our data: `sdk.name` would otherwise be
// redacted by the `name` key and break SDK attribution in the UI. Mirrors
// `_SKIP_KEYS` in the Python module.
const SKIP_KEYS = ['sdk'];

// Guards against a circular structure making the walk recurse forever.
const MAX_DEPTH = 12;

export function scrubText(value) {
  if (typeof value !== 'string') return value;
  return TEXT_PATTERNS.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    value,
  );
}

/** Drop a URL's query string, keeping scheme, host and path. */
export function stripQuery(url) {
  if (typeof url !== 'string') return url;
  return url.split('?')[0];
}

function scrubEntry(key, item, depth) {
  const lowered = String(key).toLowerCase();
  if (SENSITIVE_KEYS.has(lowered) || QUERY_KEYS.has(lowered)) return REDACTED;
  if (URL_KEYS.has(lowered)) return scrubValue(stripQuery(item), depth + 1);
  return scrubValue(item, depth + 1);
}

export function scrubValue(value, depth = 0) {
  if (depth > MAX_DEPTH) throw new RangeError('scrubValue: structure too deep');
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, scrubEntry(key, item, depth)]),
    );
  }
  return scrubText(value);
}

/**
 * `beforeSend` *and* `beforeSendTransaction`: scrub the whole event, or drop
 * it if that fails. Wiring both matters — `beforeSend` runs on error events
 * alone, so without the transaction hook every browser transaction, and every
 * fetch/XHR span URL on it, bypasses scrubbing entirely.
 */
export function scrubEvent(event) {
  try {
    const scrubbed = scrubValue(event);
    // Restore Sentry's own protocol metadata — see SKIP_KEYS.
    if (event !== null && typeof event === 'object' && !Array.isArray(event)) {
      SKIP_KEYS.forEach((key) => {
        if (key in event) scrubbed[key] = event[key];
      });
    }
    return scrubbed;
  } catch {
    return null;
  }
}

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

// Guards against a circular structure making the walk recurse forever.
const MAX_DEPTH = 12;

export function scrubText(value) {
  if (typeof value !== 'string') return value;
  return TEXT_PATTERNS.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    value,
  );
}

export function scrubValue(value, depth = 0) {
  if (depth > MAX_DEPTH) throw new RangeError('scrubValue: structure too deep');
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEYS.has(String(key).toLowerCase())
          ? REDACTED
          : scrubValue(item, depth + 1),
      ]),
    );
  }
  return scrubText(value);
}

/** `beforeSend`: scrub the whole event, or drop it if that fails. */
export function scrubEvent(event) {
  try {
    return scrubValue(event);
  } catch {
    return null;
  }
}

// Pure view model behind the tabbed client-lookup sheet (iOS redesign,
// phase 4). No React, no antd — every function here is a plain data
// transform so it can be unit-tested without rendering anything.
//
// The behaviour ported below (normalizePhone, the digit/mobile rules, the
// name split) matches the pre-redesign client-lookup flow exactly; do not
// invent new rules here.

export const LOOKUP_TABS = ['id', 'phone', 'name'];

export const AUTO_LOOKUP_DEBOUNCE_MS = 1500;

// Shortest identifier worth an unprompted round-trip: a 9-digit legal-entity
// tax ID. Shorter values are almost always a half-typed ID, and 1C matches
// `IDPhone` against the phone column too, so a stray short number can come
// back as a false-positive client. Submitting the form still looks any
// length up.
export const AUTO_LOOKUP_MIN_ID_DIGITS = 9;

// A one- or two-letter fragment is a half-typed name, not a query: it spends
// an upstream round-trip to hand back a list nobody can pick from. A name is
// also never auto-searched at all (see tabConfig's 'submit' trigger below) —
// unlike an ID, a name is never complete mid-typing, so an auto-search would
// fire on every pause and each is an upstream LIKE query.
export const NAME_MIN_CHARS = 3;

const TAB_CONFIG = {
    id: {
        labelKey: 'lookupByIdTab',
        placeholderKey: 'lookupIdPlaceholder',
        inputMode: 'numeric',
        trigger: 'auto',
    },
    phone: {
        labelKey: 'lookupByPhoneTab',
        placeholderKey: 'lookupPhonePlaceholder',
        inputMode: 'tel',
        trigger: 'auto',
    },
    name: {
        labelKey: 'lookupByNameTab',
        placeholderKey: 'lookupNamePlaceholder',
        inputMode: 'text',
        trigger: 'submit',
    },
};

export const tabConfig = (tab) => TAB_CONFIG[tab];

// Georgian mobile numbers are 9 digits beginning with 5 (the operator prefix).
// Strip a leading +995 / 995 / 0 if the user pasted an international form.
export const normalizePhone = (raw) => {
    let v = (raw || '').replace(/[\s()-]/g, '');
    if (v.startsWith('+995')) v = v.slice(4);
    else if (v.startsWith('995')) v = v.slice(3);
    else if (v.startsWith('0')) v = v.slice(1);
    return v;
};

const MOBILE_RE = /^5\d{8}$/;
// An identifier's length varies — a personal number is 11 digits, a legal
// entity's tax ID is 9, and upstream accepts other shapes — so the only
// thing rejected here is non-numeric input, which is almost certainly a
// phone (or a name) typed into the wrong field.
const PERSONAL_ID_RE = /^\d+$/;

export const isSearchable = (tab, value) => {
    const trimmed = (value || '').trim();
    if (tab === 'id') {
        return PERSONAL_ID_RE.test(trimmed) && trimmed.length >= AUTO_LOOKUP_MIN_ID_DIGITS;
    }
    if (tab === 'phone') {
        return MOBILE_RE.test(normalizePhone(trimmed));
    }
    if (tab === 'name') {
        return trimmed.length >= NAME_MIN_CHARS;
    }
    return false;
};

// Exactly one criterion per lookup, matching CheckClientAPIView's contract.
export const lookupArgs = (tab, value) => {
    const trimmed = (value || '').trim();
    if (tab === 'id') return {identification_number: trimmed};
    if (tab === 'phone') return {phone: normalizePhone(trimmed)};
    return {name: trimmed};
};

// 1C stores the client as a single display name; the create form wants it in
// two fields. Split on the first space — "გიორგი ბერიძე" is first + last —
// and leave the surname empty for a single token, which the consultant fills
// in anyway before registering.
const splitName = (raw) => {
    const value = (raw || '').trim().replace(/\s+/g, ' ');
    if (!value) return {first_name: '', last_name: ''};
    const cut = value.indexOf(' ');
    if (cut === -1) return {first_name: value, last_name: ''};
    return {first_name: value.slice(0, cut), last_name: value.slice(cut + 1)};
};

// Everything the lookup step hands to the create step when the client turns
// out not to exist upstream.
export const createSeed = (tab, value) => {
    const seed = {
        identification_number: '',
        phone: '',
        first_name: '',
        last_name: '',
    };
    const trimmed = (value || '').trim();
    if (tab === 'id') return {...seed, identification_number: trimmed};
    if (tab === 'phone') return {...seed, phone: normalizePhone(trimmed)};
    return {...seed, ...splitName(trimmed)};
};

// Upstream returns {name, address, phone}; project it into the sheet row
// shape. The identifier and phone share one meta line, joined by a middot,
// and either half is dropped rather than leaving a dangling separator. The
// caller (ClientLookupSheet's results list) always supplies the row's index
// as `key`, since 1C sends no id of its own and two results can share every
// other field.
export const clientRow = (client, key) => ({
    key,
    title: client.name || '',
    meta: [client.identification_number, client.phone].filter(Boolean).join(' · '),
    address: client.address || '',
});

export const countLabel = (count, t) => `${count} ${t.clientsFoundCount}`;

// A short inline hint for a value that is non-empty but not yet searchable —
// the ID/phone tabs auto-search on a debounce with no submit step, so this is
// the only feedback a consultant gets before it silently does nothing (or,
// on the name tab, before the submit affordance appears). Returns an i18n
// key, or null when there's nothing to say (empty field, or already
// searchable).
export const searchHint = (tab, value) => {
    if (!(value || '').trim() || isSearchable(tab, value)) return null;
    if (tab === 'id') return 'lookupIdHint';
    if (tab === 'phone') return 'lookupPhoneHint';
    return 'lookupNameHint';
};

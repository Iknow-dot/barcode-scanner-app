import displayCustomerName from '../../utils/orderDisplay';

// Pure view model for the consultant Orders tab (iOS redesign phase 5a): three
// status segments over date-grouped rows. Nothing here reads the system clock
// or touches React/antd — every caller passes `now`, so every function here
// is deterministic and unit-testable without faking timers.

export const ORDER_SEGMENTS = ['draft', 'confirmed', 'completed'];

// The canvas renames "draft" to "Open" for the consultant-facing segment —
// 'confirmed'/'completed' keep their order-status names.
const SEGMENT_LABEL_KEYS = {
    draft: 'ordersSegmentOpen',
    confirmed: 'ordersSegmentConfirmed',
    completed: 'ordersSegmentCompleted',
};

export const segmentLabelKey = (segment) => SEGMENT_LABEL_KEYS[segment];

// Draft orders are scoped to the current consultant (mirrors the old
// fetchIncompleteOrders filter); confirmed/completed are org-wide so a
// consultant can find a colleague's order.
export const segmentQuery = (segment, {userId} = {}) => (
    segment === 'draft' ? {status: segment, created_by: userId} : {status: segment}
);

// First letter of each of the first two words. Retail orders never call this
// (orderRow blanks initials for them instead) since there is no name to take
// letters from.
export const initialsOf = (name) => (
    (name || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word[0])
        .join('')
);

const pad2 = (n) => String(n).padStart(2, '0');

// Calendar-day key ("2026-09-18") in the *viewer's* local time zone, used
// both to decide "same day as now" for relativeTime and to bucket rows in
// groupByDay. Deliberately local rather than UTC: the API returns Z-suffixed
// timestamps, and a fixed UTC cut-off mis-groups (and mis-labels the clock
// fallback for) any consultant east or west of UTC — Tbilisi is UTC+4, so a
// same-local-day order created after ~20:00 local reads as tomorrow's UTC
// date. Local getters (not toISOString) are exactly what the consultant's
// own device already shows, and stay pure — this still only reads `value`,
// never the system clock.
const dayKeyOf = (value) => {
    const d = new Date(value);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/**
 * A row's timestamp as an i18n key + optional value, never a finished
 * string — the caller looks the key up in `t`. `now` is passed in rather
 * than read from the clock, so this is deterministic (given a fixed time
 * zone — see the test file for how the suite pins one):
 *   - under a minute: {key: 'justNow'}
 *   - same local day, under an hour: {key: 'minAgo', value: n}
 *   - same local day, an hour or more: {key: 'hoursAgo', value: n}
 *   - an earlier local day: {key: 'clock', value: 'HH:MM'} (that day's own
 *     local time, not a duration — a day boundary always wins over the hour
 *     count)
 *   - no timestamp: {key: 'none'}
 */
export const relativeTime = (iso, now) => {
    if (!iso) return {key: 'none'};
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return {key: 'none'};

    if (dayKeyOf(date) === dayKeyOf(now)) {
        const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000);
        if (diffMin < 1) return {key: 'justNow'};
        if (diffMin < 60) return {key: 'minAgo', value: diffMin};
        return {key: 'hoursAgo', value: Math.floor(diffMin / 60)};
    }
    return {key: 'clock', value: `${pad2(date.getHours())}:${pad2(date.getMinutes())}`};
};

/**
 * One order → one canvas row. `total` is omitted (left `undefined`) when the
 * order carries none, so a row never shows a stray "undefined ₾". Retail
 * orders show the cart glyph instead of a monogram, so `initials` is blank
 * for them even though `name` still carries the retail label (for the row's
 * title text) via the shared, already-tested displayCustomerName.
 */
export const orderRow = (order, t, now) => {
    const isRetail = !!(order && order.is_retail);
    const name = displayCustomerName(order, t);
    const idLabel = `#${order.id}`;
    const meta = order.items_count > 0
        ? `${idLabel} · ${order.items_count} ${t.productCountSuffix}`
        : idLabel;
    return {
        key: order.id,
        initials: isRetail ? '' : initialsOf(name),
        isRetail,
        name,
        meta,
        total: order.total == null ? undefined : order.total,
        time: relativeTime(order.created_at, now),
        isResumable: order.status === 'draft',
    };
};

// "DD.MM.YYYY" from a "YYYY-MM-DD" day key — built by hand (not
// toLocaleDateString) so grouping stays locale- and environment-independent,
// same reasoning as relativeTime's hand-built clock string.
const headingValueForDate = (dayKey) => {
    const [y, m, d] = dayKey.split('-');
    return `${d}.${m}.${y}`;
};

/**
 * Orders bucketed by the viewer's local calendar day, in first-seen order
 * (the API already returns orders newest-first, so this naturally comes out
 * today → yesterday → older). Today/yesterday head by name
 * (`headingKey: 'today'|'yesterday'`, looked up in `t`); older days head by
 * their own date, carried as literal text in `headingValue` since there is
 * no i18n key per calendar date.
 */
export const groupByDay = (orders, now) => {
    const todayKey = dayKeyOf(now);
    const yesterdayKey = dayKeyOf(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    const groups = [];
    const byKey = new Map();

    orders.forEach((order) => {
        const key = dayKeyOf(order.created_at);
        let group = byKey.get(key);
        if (!group) {
            const headingKey = key === todayKey ? 'today' : key === yesterdayKey ? 'yesterday' : 'date';
            group = {
                key,
                headingKey,
                headingValue: headingKey === 'date' ? headingValueForDate(key) : undefined,
                orders: [],
            };
            byKey.set(key, group);
            groups.push(group);
        }
        group.orders.push(order);
    });

    return groups;
};

/**
 * i18n key for the segment's empty state. A live customer search (across all
 * orgs orders) reuses the existing search-empty copy; otherwise the "draft"
 * segment reuses the existing open-orders copy ("ღია შეკვეთები არ არის",
 * which is exactly this state) and the other two segments share a new,
 * segment-agnostic key.
 */
export const emptyCopyKey = (segment, isSearching) => {
    if (isSearching) return 'noOrders';
    return segment === 'draft' ? 'noIncompleteOrders' : 'noOrdersInSegment';
};

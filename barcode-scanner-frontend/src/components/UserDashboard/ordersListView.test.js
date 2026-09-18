import {
    ORDER_SEGMENTS,
    segmentLabelKey,
    segmentQuery,
    initialsOf,
    relativeTime,
    orderRow,
    groupByDay,
    emptyCopyKey,
} from './ordersListView';

// relativeTime/groupByDay bucket by the *local* calendar day (R1 fix — see
// ordersListView.js's dayKeyOf), so their tests need a fixed local time zone
// to be deterministic across machines/CI. Pinned to Tbilisi (UTC+4, no DST —
// the one real consultant zone this app ships for) here, scoped to this file
// only: set in beforeAll rather than src/setupTests.js so it can't perturb
// any other suite's Date handling, and restored in afterAll (deleting the
// var, not re-assigning `undefined`, which Node would stringify to "undefined"
// and break TZ resolution) so it doesn't leak into whichever test file this
// Jest worker runs next.
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
    process.env.TZ = 'Asia/Tbilisi';
});
afterAll(() => {
    if (ORIGINAL_TZ === undefined) {
        delete process.env.TZ;
    } else {
        process.env.TZ = ORIGINAL_TZ;
    }
});

const NOW = new Date('2026-09-18T12:00:00Z'); // Tbilisi local: 2026-09-18 16:00

// Minimal fake `t` — only the keys orderRow actually reads, same pattern as
// orderDisplay.test.js, so this test doesn't depend on the full translations
// file.
const t = {
    retailCustomerLabel: 'Retail customer',
    productCountSuffix: 'products',
};

describe('ORDER_SEGMENTS', () => {
    it('is the three canvas segments in display order', () => {
        expect(ORDER_SEGMENTS).toEqual(['draft', 'confirmed', 'completed']);
    });
});

describe('segmentLabelKey', () => {
    it('maps each segment to its own i18n key', () => {
        expect(segmentLabelKey('draft')).toBe('ordersSegmentOpen');
        expect(segmentLabelKey('confirmed')).toBe('ordersSegmentConfirmed');
        expect(segmentLabelKey('completed')).toBe('ordersSegmentCompleted');
    });
});

describe('segmentQuery', () => {
    it('asks for my own drafts, and org-wide for the other two', () => {
        expect(segmentQuery('draft', {userId: 7})).toEqual({status: 'draft', created_by: 7});
        expect(segmentQuery('confirmed', {userId: 7})).toEqual({status: 'confirmed'});
        expect(segmentQuery('completed', {userId: 7})).toEqual({status: 'completed'});
    });
});

describe('initialsOf', () => {
    it('takes the first letter of the first two words', () => {
        expect(initialsOf('გიორგი ბერიძე')).toBe('გბ');
        expect(initialsOf('ნინო')).toBe('ნ');
        expect(initialsOf('')).toBe('');
    });

    it('ignores a null/undefined name and extra whitespace', () => {
        expect(initialsOf(null)).toBe('');
        expect(initialsOf(undefined)).toBe('');
        expect(initialsOf('  Nino   Beridze  ')).toBe('NB');
    });
});

describe('relativeTime', () => {
    it('reads as just now under a minute', () => {
        expect(relativeTime('2026-09-18T11:59:30Z', NOW)).toEqual({key: 'justNow'});
    });
    it('counts minutes, then hours', () => {
        expect(relativeTime('2026-09-18T11:35:00Z', NOW)).toEqual({key: 'minAgo', value: 25});
        expect(relativeTime('2026-09-18T10:00:00Z', NOW)).toEqual({key: 'hoursAgo', value: 2});
    });
    // R1 fix regression test, modelled on groupByDay's own boundary test: 59s
    // must still read as just-now and 60s must already read as 1 minute ago,
    // so a regression like `diffMin <= 1` (instead of `< 1`) would fail this.
    it('sits exactly on the just-now / minutes-ago boundary', () => {
        expect(relativeTime('2026-09-18T11:59:01Z', NOW)).toEqual({key: 'justNow'}); // 59s before
        expect(relativeTime('2026-09-18T11:59:00Z', NOW)).toEqual({key: 'minAgo', value: 1}); // 60s before
    });
    it('sits exactly on the minutes-ago / hours-ago boundary', () => {
        expect(relativeTime('2026-09-18T11:01:00Z', NOW)).toEqual({key: 'minAgo', value: 59}); // 59 min before
        expect(relativeTime('2026-09-18T11:00:00Z', NOW)).toEqual({key: 'hoursAgo', value: 1}); // 60 min before
    });
    it('falls back to a clock time on an earlier day, in the viewer\'s local time', () => {
        // 2026-09-17T18:20:00Z is Tbilisi-local 22:20 (UTC+4) — asserting
        // '18:20' here would be the R1 bug (UTC hours shown as if local).
        expect(relativeTime('2026-09-17T18:20:00Z', NOW)).toEqual({key: 'clock', value: '22:20'});
    });
    // R1: the reviewer's Tbilisi scenario. An order at local 00:45 (UTC
    // 20:45 the previous day) must show its own local clock, not the UTC
    // hour, once it does fall to the clock branch (a `now` a full local day
    // later — see groupByDay below for the same order's *grouping* fix).
    it('shows the Tbilisi-local clock, not the UTC hour, for a late-evening-UTC order', () => {
        const createdAt = '2026-09-18T20:45:00Z'; // Tbilisi local: 2026-09-19 00:45
        const laterNow = new Date('2026-09-20T06:00:00Z'); // Tbilisi local: 2026-09-20 10:00
        expect(relativeTime(createdAt, laterNow)).toEqual({key: 'clock', value: '00:45'});
    });
    it('reports none for a missing or invalid timestamp', () => {
        expect(relativeTime(null, NOW)).toEqual({key: 'none'});
        expect(relativeTime(undefined, NOW)).toEqual({key: 'none'});
        expect(relativeTime('not-a-date', NOW)).toEqual({key: 'none'});
    });
});

describe('groupByDay', () => {
    it('heads today and yesterday by name and older days by date', () => {
        const groups = groupByDay([
            {id: 1, created_at: '2026-09-18T11:00:00Z'},
            {id: 2, created_at: '2026-09-17T18:20:00Z'},
            {id: 3, created_at: '2026-09-02T09:00:00Z'},
        ], NOW);
        expect(groups.map((g) => g.headingKey)).toEqual(['today', 'yesterday', 'date']);
        expect(groups[0].orders).toHaveLength(1);
        expect(groups[0].headingValue).toBeUndefined();
        expect(groups[2].headingValue).toBe('02.09.2026');
    });

    it('keeps a day boundary even when the two orders are minutes apart', () => {
        // Tbilisi local midnight falls at 20:00 UTC the previous day, so
        // these (not UTC midnight) are the pair that actually straddles it —
        // 2026-09-17T23:55:00Z/2026-09-18T00:05:00Z both read as local
        // 2026-09-18 under the R1 fix and would wrongly merge into one group.
        const groups = groupByDay([
            {id: 1, created_at: '2026-09-17T20:05:00Z'}, // Tbilisi local: 2026-09-18 00:05
            {id: 2, created_at: '2026-09-17T19:55:00Z'}, // Tbilisi local: 2026-09-17 23:55
        ], NOW);
        expect(groups).toHaveLength(2);
    });

    it('groups multiple orders from the same day together', () => {
        const groups = groupByDay([
            {id: 1, created_at: '2026-09-18T11:00:00Z'},
            {id: 2, created_at: '2026-09-18T09:00:00Z'},
        ], NOW);
        expect(groups).toHaveLength(1);
        expect(groups[0].orders.map((o) => o.id)).toEqual([1, 2]);
    });

    // R1: the reviewer's Tbilisi scenario. An order created at UTC 20:45 is
    // already local 00:45 the next day; bucketing by UTC day (the bug) would
    // wrongly file it under yesterday instead of today.
    it('buckets a late-evening-UTC order under the viewer\'s local today, not UTC yesterday', () => {
        const groups = groupByDay([
            {id: 1, created_at: '2026-09-18T20:45:00Z'}, // Tbilisi local: 2026-09-19 00:45
        ], new Date('2026-09-19T06:00:00Z')); // Tbilisi local: 2026-09-19 10:00 (same local day)
        expect(groups).toHaveLength(1);
        expect(groups[0].headingKey).toBe('today');
    });
});

describe('orderRow', () => {
    const base = {
        id: 1048,
        status: 'confirmed',
        customer_name: 'Nino Beridze',
        is_retail: false,
        items_count: 3,
        total: 150,
        created_at: '2026-09-18T11:35:00Z',
    };

    it('builds a "#id · count unit" meta line', () => {
        expect(orderRow(base, t, NOW).meta).toBe('#1048 · 3 products');
    });

    it('omits the product count when items_count is 0', () => {
        expect(orderRow({...base, items_count: 0}, t, NOW).meta).toBe('#1048');
    });

    it('blanks initials and flags isRetail for a retail order', () => {
        const row = orderRow({...base, is_retail: true, customer_name: ''}, t, NOW);
        expect(row.isRetail).toBe(true);
        expect(row.initials).toBe('');
        expect(row.name).toBe('Retail customer');
    });

    it('takes initials from the customer name otherwise', () => {
        expect(orderRow(base, t, NOW).initials).toBe('NB');
    });

    it('omits total when the order carries none', () => {
        expect(orderRow({...base, total: null}, t, NOW).total).toBeUndefined();
        expect(orderRow({...base, total: undefined}, t, NOW).total).toBeUndefined();
        expect(orderRow(base, t, NOW).total).toBe(150);
    });

    it('is resumable only for a draft order', () => {
        expect(orderRow({...base, status: 'draft'}, t, NOW).isResumable).toBe(true);
        expect(orderRow({...base, status: 'confirmed'}, t, NOW).isResumable).toBe(false);
        expect(orderRow({...base, status: 'completed'}, t, NOW).isResumable).toBe(false);
    });

    it('carries the row time from relativeTime', () => {
        expect(orderRow(base, t, NOW).time).toEqual({key: 'minAgo', value: 25});
    });
});

describe('emptyCopyKey', () => {
    it('uses the shared search-empty copy while searching, regardless of segment', () => {
        expect(emptyCopyKey('draft', true)).toBe('noOrders');
        expect(emptyCopyKey('confirmed', true)).toBe('noOrders');
        expect(emptyCopyKey('completed', true)).toBe('noOrders');
    });

    it('reuses the existing open-orders copy for an empty draft segment', () => {
        expect(emptyCopyKey('draft', false)).toBe('noIncompleteOrders');
    });

    it('uses the new segment-agnostic copy for confirmed/completed', () => {
        expect(emptyCopyKey('confirmed', false)).toBe('noOrdersInSegment');
        expect(emptyCopyKey('completed', false)).toBe('noOrdersInSegment');
    });
});

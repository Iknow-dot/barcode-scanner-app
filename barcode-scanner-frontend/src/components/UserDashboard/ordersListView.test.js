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

const NOW = new Date('2026-09-18T12:00:00Z');

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
        expect(relativeTime('2026-09-18T11:35:00Z', NOW)).toEqual({key: 'minutesAgo', value: 25});
        expect(relativeTime('2026-09-18T10:00:00Z', NOW)).toEqual({key: 'hoursAgo', value: 2});
    });
    it('falls back to a clock time on an earlier day', () => {
        expect(relativeTime('2026-09-17T18:20:00Z', NOW)).toEqual({key: 'clock', value: '18:20'});
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
        const groups = groupByDay([
            {id: 1, created_at: '2026-09-18T00:05:00Z'},
            {id: 2, created_at: '2026-09-17T23:55:00Z'},
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
        expect(orderRow(base, t, NOW).time).toEqual({key: 'minutesAgo', value: 25});
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

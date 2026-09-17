import {EMPTY_ORDERS_SUMMARY, completedShare, summarizeTodayOrders} from './todayOrdersSummary';

describe('summarizeTodayOrders', () => {
    it('returns zeros for no orders or a non-array', () => {
        expect(summarizeTodayOrders([])).toEqual(EMPTY_ORDERS_SUMMARY);
        expect(summarizeTodayOrders(undefined)).toEqual(EMPTY_ORDERS_SUMMARY);
    });

    it('counts every order and splits placed from completed', () => {
        const summary = summarizeTodayOrders([
            {status: 'draft', total: '120.00'},
            {status: 'confirmed', total: '89.90'},
            {status: 'completed', total: '672.00'},
            {status: 'cancelled', total: '50.00'},
        ]);
        expect(summary.count).toBe(4);
        expect(summary.placedCount).toBe(2);
        expect(summary.placedTotal).toBeCloseTo(761.9, 2);
        expect(summary.completedCount).toBe(1);
        expect(summary.completedTotal).toBeCloseTo(672, 2);
    });

    it('keeps total equal to the placed total for older callers', () => {
        const summary = summarizeTodayOrders([
            {status: 'confirmed', total: '10.50'},
            {status: 'draft', total: '99.00'},
        ]);
        expect(summary.total).toBeCloseTo(10.5, 2);
        expect(summary.total).toBe(summary.placedTotal);
    });

    it('treats a missing or unparseable total as zero', () => {
        const summary = summarizeTodayOrders([
            {status: 'completed', total: null},
            {status: 'completed', total: 'n/a'},
            {status: 'completed', total: 5},
        ]);
        expect(summary.completedCount).toBe(3);
        expect(summary.completedTotal).toBe(5);
    });
});

describe('completedShare', () => {
    it('is the completed amount over the placed amount', () => {
        expect(completedShare({placedTotal: 761.9, completedTotal: 672})).toBeCloseTo(0.882, 3);
    });

    it('is zero when nothing is placed or there is no summary', () => {
        expect(completedShare(EMPTY_ORDERS_SUMMARY)).toBe(0);
        expect(completedShare(null)).toBe(0);
    });

    it('never exceeds one', () => {
        expect(completedShare({placedTotal: 10, completedTotal: 12})).toBe(1);
    });
});

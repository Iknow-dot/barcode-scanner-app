import {
    STOCK_STATUS_NO_LOOKUP_KEY,
    STOCK_STATUS_UNAVAILABLE,
    isStockBlocked,
    stockStatusMessageKey,
} from './stockStatus';

describe('isStockBlocked', () => {
    it('blocks on any non-empty status', () => {
        expect(isStockBlocked(STOCK_STATUS_UNAVAILABLE)).toBe(true);
        expect(isStockBlocked(STOCK_STATUS_NO_LOOKUP_KEY)).toBe(true);
    });

    it('does not block when the backend sent no status', () => {
        expect(isStockBlocked(undefined)).toBe(false);
        expect(isStockBlocked('')).toBe(false);
    });

    it('blocks on an unrecognised status rather than silently showing empty balances', () => {
        expect(isStockBlocked('something_new')).toBe(true);
    });
});

describe('stockStatusMessageKey', () => {
    it('explains a missing lookup key separately from an upstream outage', () => {
        expect(stockStatusMessageKey(STOCK_STATUS_NO_LOOKUP_KEY))
            .toBe('stockLookupKeyMissing');
    });

    it('falls back to the outage wording for unavailable and anything unknown', () => {
        expect(stockStatusMessageKey(STOCK_STATUS_UNAVAILABLE)).toBe('stockUnavailable');
        expect(stockStatusMessageKey('something_new')).toBe('stockUnavailable');
    });
});

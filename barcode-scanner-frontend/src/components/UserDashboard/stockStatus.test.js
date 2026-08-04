import {
    STOCK_STATUS_NO_LOOKUP_KEY,
    STOCK_STATUS_UNAVAILABLE,
    hasProductResult,
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

describe('hasProductResult', () => {
    const resolved = {sku: '000000007126', sku_name: 'GASTRO'};
    const cleared = {sku_name: '', article: '', price: '', images: []};

    it('counts a resolved product with stock as a result', () => {
        expect(hasProductResult(resolved, [{warehouse: 'W1', quantity: '3.000'}])).toBe(true);
    });

    it('counts a resolved product with NO stock anywhere as a result', () => {
        // Regression: an out-of-stock product used to fail its 1C lookup and so
        // arrived flagged "unavailable", which is what kept the card on screen.
        // Now it legitimately returns an empty stock list with no status, and
        // the card must still render instead of the blank empty state.
        expect(hasProductResult(resolved, [])).toBe(true);
    });

    it('is not a result before anything has been searched', () => {
        expect(hasProductResult(cleared, [])).toBe(false);
    });

    it('is not a result after a failed search clears the product', () => {
        expect(hasProductResult(cleared, [])).toBe(false);
        expect(hasProductResult({}, [])).toBe(false);
    });

    it('tolerates a missing balances list', () => {
        expect(hasProductResult(resolved, undefined)).toBe(true);
        expect(hasProductResult(cleared, undefined)).toBe(false);
    });
});

import distributeStock from './distributeStock';

const wh = (code, quantity) => ({warehouse: code, quantity});

describe('distributeStock', () => {
    test('target fits in one assigned warehouse', () => {
        const result = distributeStock(5, [wh('W1', 10), wh('W2', 8)], new Set(['W1']));
        expect([...result.entries()]).toEqual([['W1', 5]]);
    });

    test('target spans multiple assigned warehouses, biggest first (stock-desc)', () => {
        const result = distributeStock(15, [wh('W1', 5), wh('W2', 12), wh('W3', 4)], new Set(['W1', 'W2']));
        // Assigned tier: W2 (12) > W1 (5). Allocate 12 from W2, then 3 from W1.
        expect([...result.entries()]).toEqual([['W2', 12], ['W1', 3]]);
    });

    test('target spills into non-assigned tier after assigned exhausted', () => {
        const result = distributeStock(20, [wh('W1', 10), wh('W2', 8), wh('W3', 15)], new Set(['W1']));
        // Assigned tier: W1 (10). Non-assigned tier (stock-desc): W3 (15) > W2 (8).
        // Take 10 from W1, then 10 from W3.
        expect([...result.entries()]).toEqual([['W1', 10], ['W3', 10]]);
    });

    test('target exceeds total stock — returns max allocatable', () => {
        const result = distributeStock(50, [wh('W1', 10), wh('W2', 5)], new Set(['W1']));
        expect([...result.entries()]).toEqual([['W1', 10], ['W2', 5]]);
    });

    test('zero / negative target returns empty map', () => {
        expect([...distributeStock(0, [wh('W1', 10)], new Set(['W1'])).entries()]).toEqual([]);
        expect([...distributeStock(-3, [wh('W1', 10)], new Set(['W1'])).entries()]).toEqual([]);
    });

    test('no assigned warehouses falls back entirely to non-assigned (stock-desc)', () => {
        const result = distributeStock(8, [wh('W1', 3), wh('W2', 6)], new Set());
        expect([...result.entries()]).toEqual([['W2', 6], ['W1', 2]]);
    });

    test('empty warehouses list returns empty map', () => {
        expect([...distributeStock(5, [], new Set(['W1'])).entries()]).toEqual([]);
    });

    test('warehouses with zero stock are skipped', () => {
        const result = distributeStock(5, [wh('W1', 0), wh('W2', 8)], new Set(['W1']));
        expect([...result.entries()]).toEqual([['W2', 5]]);
    });
});

import groupItemsBySku from './groupItemsBySku';

const mkItem = (overrides) => ({
    id: 1,
    sku: 'SKU1',
    sku_name: 'Widget',
    article: 'ART1',
    price: '100.00',
    quantity: 1,
    warehouse_code: 'WHA',
    warehouse_name: 'WH-A',
    unit: 'piece',
    discount_percent: '0.00',
    discounted_price: null,
    effective_price: '100.00',
    line_total: '100.00',
    added_at: '2026-05-04T10:00:00Z',
    ...overrides,
});

describe('groupItemsBySku', () => {
    it('returns an empty array for no items', () => {
        expect(groupItemsBySku([])).toEqual([]);
    });

    it('returns one group per unique SKU, preserving first-added order', () => {
        const items = [
            mkItem({id: 1, sku: 'A', added_at: '2026-05-04T10:00:00Z'}),
            mkItem({id: 2, sku: 'B', added_at: '2026-05-04T10:01:00Z'}),
            mkItem({id: 3, sku: 'A', warehouse_code: 'WHB', added_at: '2026-05-04T10:02:00Z'}),
        ];
        const groups = groupItemsBySku(items);
        expect(groups.map(g => g.sku)).toEqual(['A', 'B']);
        expect(groups[0].items.map(i => i.id)).toEqual([1, 3]);
        expect(groups[1].items.map(i => i.id)).toEqual([2]);
    });

    it('flags shared price/discount/unit when all lines agree', () => {
        const items = [
            mkItem({id: 1, warehouse_code: 'WHA', effective_price: '90.00', discount_percent: '10.00'}),
            mkItem({id: 2, warehouse_code: 'WHB', effective_price: '90.00', discount_percent: '10.00'}),
        ];
        const [g] = groupItemsBySku(items);
        expect(g.isMixedPrice).toBe(false);
        expect(g.sharedPrice).toBe('90.00');
        expect(g.isMixedDiscount).toBe(false);
        expect(g.sharedDiscountPercent).toBe('10.00');
        expect(g.isMixedUnit).toBe(false);
        expect(g.sharedUnit).toBe('piece');
    });

    it('flags mixed when effective prices differ across warehouses', () => {
        const items = [
            mkItem({id: 1, warehouse_code: 'WHA', effective_price: '80.00'}),
            mkItem({id: 2, warehouse_code: 'WHB', effective_price: '100.00'}),
        ];
        const [g] = groupItemsBySku(items);
        expect(g.isMixedPrice).toBe(true);
        expect(g.sharedPrice).toBeNull();
        expect(g.minPrice).toBe('80.00');
        expect(g.maxPrice).toBe('100.00');
    });

    it('sums quantity and line_total across the group', () => {
        const items = [
            mkItem({id: 1, quantity: 2, line_total: '200.00'}),
            mkItem({id: 2, warehouse_code: 'WHB', quantity: 3, line_total: '300.00'}),
        ];
        const [g] = groupItemsBySku(items);
        expect(g.totalQty).toBe(5);
        expect(g.groupLineTotal).toBe('500.00');
    });

    it('treats discount as mixed if one line uses percent and another uses discounted_price', () => {
        const items = [
            mkItem({id: 1, discount_percent: '10.00', discounted_price: null}),
            mkItem({id: 2, warehouse_code: 'WHB', discount_percent: '0.00', discounted_price: '90.00'}),
        ];
        const [g] = groupItemsBySku(items);
        expect(g.isMixedDiscount).toBe(true);
    });
});

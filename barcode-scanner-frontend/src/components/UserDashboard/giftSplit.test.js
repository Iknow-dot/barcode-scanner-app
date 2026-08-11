import {pairGiftLines, planGiftChange} from './giftSplit';

const paid = (over = {}) => ({
    id: 1, sku: 'S1', sku_name: 'Widget', article: 'A1', price: '10.00',
    quantity: 3, warehouse_code: 'WHA', warehouse_name: 'WH-A', unit: 'piece',
    is_gift: false, ...over,
});
const gift = (over = {}) => paid({id: 2, quantity: 1, is_gift: true, ...over});

describe('pairGiftLines', () => {
    it('pairs a paid and gift line of the same warehouse into one row', () => {
        const rows = pairGiftLines([paid(), gift()]);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            warehouse_code: 'WHA', totalQty: 4, giftQty: 1,
        });
        expect(rows[0].paid.id).toBe(1);
        expect(rows[0].gift.id).toBe(2);
    });

    it('keeps different warehouses as separate rows in insertion order', () => {
        const rows = pairGiftLines([
            paid(), paid({id: 3, warehouse_code: 'WHB', warehouse_name: 'WH-B'}),
        ]);
        expect(rows.map((r) => r.warehouse_code)).toEqual(['WHA', 'WHB']);
        expect(rows[0].giftQty).toBe(0);
        expect(rows[0].gift).toBeNull();
    });

    it('handles a gift-only line', () => {
        const rows = pairGiftLines([gift({quantity: 2})]);
        expect(rows[0]).toMatchObject({totalQty: 2, giftQty: 2});
        expect(rows[0].paid).toBeNull();
    });

    it('gives duplicate same-class lines their own standalone rows', () => {
        // Bulk admin edits can produce two gift lines for one warehouse;
        // the second must not silently shadow the first in the pairing.
        const rows = pairGiftLines([paid(), gift(), gift({id: 9, quantity: 4})]);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({totalQty: 4, giftQty: 1});
        expect(rows[1]).toMatchObject({totalQty: 4, giftQty: 4});
        expect(rows[1].paid).toBeNull();
        expect(rows[1].gift.id).toBe(9);
    });
});

describe('planGiftChange', () => {
    const row = (p, g) => {
        const items = [];
        if (p) items.push(paid({quantity: p}));
        if (g) items.push(gift({quantity: g}));
        return pairGiftLines(items)[0];
    };

    it('returns no ops when the target equals the current gift count', () => {
        expect(planGiftChange(row(2, 1), 1)).toEqual([]);
    });

    it('clamps the target into [0, totalQty]', () => {
        expect(planGiftChange(row(2, 1), 99)).toEqual(planGiftChange(row(2, 1), 3));
        expect(planGiftChange(row(2, 1), -4)).toEqual(planGiftChange(row(2, 1), 0));
    });

    it('first gift on a multi-unit paid line: add gift line first, then shrink paid', () => {
        const ops = planGiftChange(row(3, 0), 1);
        expect(ops).toEqual([
            {op: 'add', data: {
                sku: 'S1', sku_name: 'Widget', article: 'A1', price: '10.00',
                quantity: 1, warehouse_code: 'WHA', warehouse_name: 'WH-A',
                unit: 'piece', is_gift: true,
            }},
            {op: 'update', itemId: 1, data: {quantity: 2}},
        ]);
    });

    it('whole single-unit line becomes a gift with a flag flip, no split', () => {
        expect(planGiftChange(row(1, 0), 1)).toEqual([
            {op: 'update', itemId: 1, data: {is_gift: true}},
        ]);
    });

    it('whole multi-unit line becomes a gift with a flag flip when no gift line exists', () => {
        expect(planGiftChange(row(3, 0), 3)).toEqual([
            {op: 'update', itemId: 1, data: {is_gift: true}},
        ]);
    });

    it('growing the gift side updates gift before paid', () => {
        expect(planGiftChange(row(2, 1), 2)).toEqual([
            {op: 'update', itemId: 2, data: {quantity: 2}},
            {op: 'update', itemId: 1, data: {quantity: 1}},
        ]);
    });

    it('shrinking the gift side updates paid before gift', () => {
        expect(planGiftChange(row(1, 2), 1)).toEqual([
            {op: 'update', itemId: 1, data: {quantity: 2}},
            {op: 'update', itemId: 2, data: {quantity: 1}},
        ]);
    });

    it('absorbing the paid line: gift grows to total, paid removed', () => {
        expect(planGiftChange(row(2, 1), 3)).toEqual([
            {op: 'update', itemId: 2, data: {quantity: 3}},
            {op: 'remove', itemId: 1},
        ]);
    });

    it('clearing gifts with both lines: paid absorbs, gift removed', () => {
        expect(planGiftChange(row(2, 1), 0)).toEqual([
            {op: 'update', itemId: 1, data: {quantity: 3}},
            {op: 'remove', itemId: 2},
        ]);
    });

    it('clearing gifts on a gift-only row flips the flag back', () => {
        expect(planGiftChange(row(0, 2), 0)).toEqual([
            {op: 'update', itemId: 2, data: {is_gift: false}},
        ]);
    });

    it('partially un-gifting a gift-only row adds a paid line first', () => {
        expect(planGiftChange(row(0, 3), 1)).toEqual([
            {op: 'add', data: {
                sku: 'S1', sku_name: 'Widget', article: 'A1', price: '10.00',
                quantity: 2, warehouse_code: 'WHA', warehouse_name: 'WH-A',
                unit: 'piece', is_gift: false,
            }},
            {op: 'update', itemId: 2, data: {quantity: 1}},
        ]);
    });
});

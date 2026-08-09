import {warehouseRowView, pickUnit} from './warehouseRowView';

describe('warehouseRowView', () => {
    it('parses DRF decimal strings into numbers', () => {
        const view = warehouseRowView({
            quantity: '3.000', reserve: '1.000', price: '31.00',
            discount_percent: '5.00', discounted_price: '29.45',
        });

        expect(view.qty).toBe(3);
        expect(view.reserve).toBe(1);
        expect(view.hasReserve).toBe(true);
        expect(view.hasDiscount).toBe(true);
        expect(view.discountPercent).toBe(5);
        expect(view.discountedPrice).toBe(29.45);
    });

    it('reports no discount when 1C sent no discount fields', () => {
        const view = warehouseRowView({quantity: '3.000', price: '9.90'});

        expect(view.hasDiscount).toBe(false);
        expect(view.discountedPrice).toBeNull();
    });

    it('reports no discount when the discounted price equals the price', () => {
        const view = warehouseRowView({
            quantity: '3.000', price: '31.00',
            discount_percent: '0.00', discounted_price: '31.00',
        });

        expect(view.hasDiscount).toBe(false);
    });

    it('computes the discounted price from the percent when 1C omits it', () => {
        const view = warehouseRowView({
            quantity: '3.000', price: '31.00', discount_percent: '5.00',
        });

        expect(view.hasDiscount).toBe(true);
        expect(view.discountedPrice).toBe(29.45);
    });

    it('keeps a zero-free-stock row with a reserve visible as reserved', () => {
        // 1C side will start returning rows with 0 free but reserved stock —
        // the row must present qty 0 alongside the reserve, not vanish.
        const view = warehouseRowView({quantity: '0.000', reserve: '4.000', price: '9.90'});

        expect(view.qty).toBe(0);
        expect(view.hasReserve).toBe(true);
        expect(view.reserve).toBe(4);
    });

    it('treats absent or zero reserve as no reserve', () => {
        expect(warehouseRowView({quantity: '2.000', price: '1.00'}).hasReserve).toBe(false);
        expect(warehouseRowView({quantity: '2.000', reserve: '0.000', price: '1.00'}).hasReserve).toBe(false);
    });
});

describe('pickUnit', () => {
    it('prefers the unit inherited from an existing order group', () => {
        expect(pickUnit('box', 'piece')).toBe('box');
    });

    it('falls back to the product unit from the search response', () => {
        expect(pickUnit(undefined, 'piece')).toBe('piece');
        expect(pickUnit('', 'piece')).toBe('piece');
    });

    it('returns empty string when neither source has a unit', () => {
        expect(pickUnit(undefined, undefined)).toBe('');
    });
});

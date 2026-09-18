import translations from '../../i18n/translations';
import {
    cartGiftCount,
    cartItemCount,
    cartRowView,
    cartSections,
    customerInitials,
    discountPatch,
    exceedsStock,
    hasOrderItems,
    orderStepHeader,
    orderWarehouseNames,
    planQuantityChange,
    pricePatch,
} from './cartSheetView';

const en = translations.en;

const line = (overrides) => ({
    id: 1,
    sku: 'PAN',
    sku_name: 'Granite pan',
    article: 'MG-2814',
    warehouse_code: 'W1',
    warehouse_name: 'Vake',
    quantity: '1',
    price: '89.90',
    effective_price: '89.90',
    discount_percent: '0.00',
    discounted_price: null,
    line_total: '89.90',
    is_gift: false,
    unit: 'piece',
    ...overrides,
});

const PAN_PAID = line({id: 1, quantity: '2', line_total: '179.80'});
const PAN_GIFT = line({id: 2, quantity: '1', is_gift: true, line_total: '0.00'});
const KETTLE = line({id: 3, sku: 'KETTLE', sku_name: 'Kettle', article: 'EK-1700', price: '119.50', effective_price: '119.50', line_total: '119.50'});
const PAN_CENTRAL = line({id: 4, warehouse_code: 'W2', warehouse_name: 'Central'});

describe('cartSections', () => {
    it('groups rows by warehouse in order of first appearance', () => {
        const sections = cartSections([PAN_PAID, PAN_CENTRAL, KETTLE, PAN_GIFT]);
        expect(sections.map((s) => s.warehouseName)).toEqual(['Vake', 'Central']);
        expect(sections[0].rows.map((r) => r.sku)).toEqual(['PAN', 'KETTLE']);
        expect(sections[1].rows.map((r) => r.sku)).toEqual(['PAN']);
    });

    it('pairs the paid and gift lines of a product into one row', () => {
        const [vake] = cartSections([PAN_PAID, PAN_GIFT]);
        expect(vake.rows).toHaveLength(1);
        expect(vake.rows[0]).toMatchObject({totalQty: 3, giftQty: 1});
        expect(vake.rows[0].paid.id).toBe(1);
        expect(vake.rows[0].gift.id).toBe(2);
    });

    it('gives every row a key unique within its section', () => {
        const [vake] = cartSections([PAN_PAID, KETTLE]);
        expect(new Set(vake.rows.map((r) => r.key)).size).toBe(2);
    });

    it('is empty for an order without items', () => {
        expect(cartSections([])).toEqual([]);
        expect(cartSections(undefined)).toEqual([]);
    });
});

describe('order counts', () => {
    const items = [PAN_PAID, PAN_GIFT, KETTLE];

    it('counts units, gifts included, and gift units alone', () => {
        expect(cartItemCount(items)).toBe(4);
        expect(cartGiftCount(items)).toBe(1);
        expect(cartItemCount(undefined)).toBe(0);
    });

    it('lists each warehouse once', () => {
        expect(orderWarehouseNames([PAN_PAID, PAN_CENTRAL, KETTLE])).toEqual(['Vake', 'Central']);
    });

    it('knows whether the order has items', () => {
        expect(hasOrderItems({items})).toBe(true);
        expect(hasOrderItems({items: []})).toBe(false);
        expect(hasOrderItems(null)).toBe(false);
    });
});

describe('customerInitials', () => {
    it('takes the first letters of the first two words', () => {
        expect(customerInitials('გიორგი ბერიძე')).toBe('გბ');
        expect(customerInitials('  anna  maria lee ')).toBe('AM');
        expect(customerInitials('')).toBe('');
    });
});

describe('cartRowView', () => {
    it('reads price, discount, line total and the quantity floor', () => {
        const [vake] = cartSections([
            {...PAN_PAID, effective_price: '80.91', discount_percent: '10.00', line_total: '161.82'},
            PAN_GIFT,
        ]);
        expect(cartRowView(vake.rows[0])).toMatchObject({
            name: 'Granite pan',
            price: '89.90',
            effectivePrice: '80.91',
            hasDiscount: true,
            discountPercent: 10,
            lineTotal: '161.82',
            pending: false,
            minQuantity: 2,
        });
    });

    it('flags lines still waiting to sync', () => {
        const [vake] = cartSections([{...PAN_PAID, id: 'tmp_abc'}]);
        expect(cartRowView(vake.rows[0]).pending).toBe(true);
    });

    it('anchors a gift-only row on its gift line', () => {
        const [vake] = cartSections([PAN_GIFT]);
        expect(cartRowView(vake.rows[0])).toMatchObject({minQuantity: 1, anchor: PAN_GIFT});
    });
});

describe('planQuantityChange', () => {
    const [vake] = cartSections([PAN_PAID, PAN_GIFT]);
    const row = vake.rows[0];

    it('moves the change onto the paid line and keeps the gifts', () => {
        expect(planQuantityChange(row, 5)).toEqual({itemId: 1, data: {quantity: 4}});
    });

    it('refuses a total that leaves no paid unit', () => {
        expect(planQuantityChange(row, 1)).toBeNull();
        expect(planQuantityChange(row, 0)).toBeNull();
    });
});

describe('price edits', () => {
    it('clears the percent when a price is set and the price when a percent is set', () => {
        expect(pricePatch(80)).toEqual({discounted_price: 80, discount_percent: 0});
        expect(pricePatch(null)).toEqual({discounted_price: null, discount_percent: 0});
        expect(discountPatch(5)).toEqual({discount_percent: 5, discounted_price: null});
        expect(discountPatch(null)).toEqual({discount_percent: 0, discounted_price: null});
    });
});

describe('exceedsStock', () => {
    it('warns only when a known stock is below the row total', () => {
        const [vake] = cartSections([PAN_PAID]);
        expect(exceedsStock(vake.rows[0], 1)).toBe(true);
        expect(exceedsStock(vake.rows[0], 2)).toBe(false);
        expect(exceedsStock(vake.rows[0], undefined)).toBe(false);
    });
});

describe('orderStepHeader', () => {
    it('titles step one as the cart and step two as delivery', () => {
        expect(orderStepHeader(1, en)).toEqual({title: en.cart, subtitle: `1 / 2 · ${en.stepProducts}`, leading: 'close'});
        expect(orderStepHeader(2, en)).toEqual({title: en.stepDelivery, subtitle: '2 / 2', leading: 'back'});
    });
});

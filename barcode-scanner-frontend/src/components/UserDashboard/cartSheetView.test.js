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
    orderDiscountTotal,
    orderStepHeader,
    orderWarehouseNames,
    planQuantityChange,
    pooledStockDemand,
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

    it('weighs a known stock against the demand given in place of the row total', () => {
        const [vake] = cartSections([PAN_PAID]);
        expect(exceedsStock(vake.rows[0], 9, 12)).toBe(true);
        expect(exceedsStock(vake.rows[0], 9, 9)).toBe(false);
        expect(exceedsStock(vake.rows[0], undefined, 12)).toBe(false);
    });
});

// The confirm (core/services/order_push.py::insufficient_stock_lines) sums
// every line's units per 1C lookup key and warehouse before comparing them
// with the balance; a row weighed alone passed here and was refused there.
describe('pooledStockDemand', () => {
    const LID = (overrides) => line({sku: 'LID', sku_name: 'Pan lid', ...overrides});
    const rowsOf = (sections) => sections.flatMap((section) => section.rows);
    const warnings = (items, stock) => {
        const sections = cartSections(items);
        const demandOf = pooledStockDemand(sections);
        return rowsOf(sections).map((row) => exceedsStock(row, stock, demandOf(row)));
    };

    it('pools two SKUs sharing an article, so both rows warn once together they exceed the balance', () => {
        const items = [line({id: 1, quantity: '6'}), LID({id: 2, quantity: '6'})];
        const sections = cartSections(items);
        const demandOf = pooledStockDemand(sections);
        expect(rowsOf(sections).map(demandOf)).toEqual([12, 12]);
        // Each row alone is within the balance — the bug this guards.
        expect(rowsOf(sections).map((row) => exceedsStock(row, 9))).toEqual([false, false]);
        expect(warnings(items, 9)).toEqual([true, true]);
    });

    it('warns neither row while the pooled demand fits the balance', () => {
        expect(warnings([line({id: 1, quantity: '4'}), LID({id: 2, quantity: '4'})], 9)).toEqual([false, false]);
    });

    it('counts gift units toward the pool, as the confirm does', () => {
        const items = [
            line({id: 1, quantity: '4'}),
            line({id: 2, quantity: '2', is_gift: true}),
            LID({id: 3, quantity: '4'}),
        ];
        expect(warnings(items, 9)).toEqual([true, true]);
    });

    it('does not pool the same article across warehouses', () => {
        const items = [line({id: 1, quantity: '6'}), LID({id: 2, quantity: '6', warehouse_code: 'W2', warehouse_name: 'Central'})];
        const sections = cartSections(items);
        expect(rowsOf(sections).map(pooledStockDemand(sections))).toEqual([6, 6]);
        expect(warnings(items, 9)).toEqual([false, false]);
    });

    it('pools a SKU without an article only with itself', () => {
        const items = [
            line({id: 1, quantity: '6', article: ''}),
            LID({id: 2, quantity: '6', article: null}),
            // An article spelled like the first SKU is still another product:
            // the confirm looks an article-less SKU up by its own barcode.
            line({id: 3, sku: 'POT', quantity: '6', article: 'PAN'}),
        ];
        const sections = cartSections(items);
        expect(rowsOf(sections).map(pooledStockDemand(sections))).toEqual([6, 6, 6]);
        expect(warnings(items, 9)).toEqual([false, false, false]);
    });

    it('pools duplicate standalone rows of one SKU in one warehouse', () => {
        const items = [line({id: 1, quantity: '5'}), line({id: 2, quantity: '5'})];
        const sections = cartSections(items);
        // pairGiftLines keeps the second paid line as a row of its own.
        expect(rowsOf(sections)).toHaveLength(2);
        expect(rowsOf(sections).map(pooledStockDemand(sections))).toEqual([10, 10]);
        expect(warnings(items, 9)).toEqual([true, true]);
    });

    // A merge re-stamps only the line it lands on (add_item: "latest scan
    // wins"), so a paid and a gift line of one SKU can carry different
    // articles. The confirm pools each line by its own; so must the cart,
    // whichever line the row happens to take its article from.
    describe('when one SKU\'s lines carry different articles', () => {
        const paidA = line({id: 1, quantity: '3'});
        const giftBare = line({id: 2, quantity: '1', is_gift: true, article: ''});
        const lidA = LID({id: 3, quantity: '4'});

        it('does not warn while the article\'s own lines fit its balance', () => {
            // Confirm: MG-2814 asks 3 + 4 = 7 of 7; the bare gift pools apart.
            const items = [paidA, giftBare, lidA];
            const sections = cartSections(items);
            expect(rowsOf(sections).map(pooledStockDemand(sections))).toEqual([7, 7]);
            expect(warnings(items, 7)).toEqual([false, false]);
        });

        it('warns every row drawing on the article once its lines exceed the balance', () => {
            // The bare gift comes first, so the row takes its blank article;
            // the paid line still draws 3 + 4 = 7 of MG-2814's 6.
            expect(warnings([giftBare, paidA, lidA], 6)).toEqual([true, true]);
        });

        it('never weighs a row at less than its own units', () => {
            const sections = cartSections([paidA, giftBare]);
            expect(rowsOf(sections).map(pooledStockDemand(sections))).toEqual([4]);
        });
    });

    it('leaves a lone row at its own units', () => {
        const sections = cartSections([PAN_PAID, PAN_GIFT, KETTLE]);
        expect(rowsOf(sections).map(pooledStockDemand(sections))).toEqual([3, 1]);
        expect(pooledStockDemand([])(rowsOf(sections)[0])).toBe(3);
        expect(pooledStockDemand(undefined)(rowsOf(sections)[1])).toBe(1);
    });
});

describe('orderStepHeader', () => {
    it('titles step one as the cart and step two as delivery', () => {
        expect(orderStepHeader(1, en)).toEqual({title: en.cart, subtitle: `1 / 2 · ${en.stepProducts}`, leading: 'close'});
        expect(orderStepHeader(2, en)).toEqual({title: en.stepDelivery, subtitle: '2 / 2', leading: 'back'});
    });
});

describe('automatic discount display', () => {
    const line = (extra) => ({id: 1, sku: 'S', price: '10.00', quantity: 2,
        discount_percent: '0.00', discounted_price: null, auto_discount_percent: '10.00',
        effective_price: '9.00', line_total: '18.00', ...extra});

    it('shows the automatic percent when no manual discount is set', () => {
        expect(cartRowView({paid: line(), gift: null, giftQty: 0}).autoDiscountPercent).toBe(10);
    });

    it('hides it behind a manual percent or set price', () => {
        expect(cartRowView({paid: line({discount_percent: '5.00', effective_price: '9.50'}), gift: null, giftQty: 0})
            .autoDiscountPercent).toBe(0);
        expect(cartRowView({paid: line({discounted_price: '8.00', effective_price: '8.00'}), gift: null, giftQty: 0})
            .autoDiscountPercent).toBe(0);
    });

    it('totals the discount across lines, gifts adding nothing', () => {
        expect(orderDiscountTotal([
            line(),
            {id: 2, price: '5.00', quantity: 1, line_total: '5.00', is_gift: true},
        ])).toBe('2.00');
        expect(orderDiscountTotal([])).toBe('0.00');
    });
});

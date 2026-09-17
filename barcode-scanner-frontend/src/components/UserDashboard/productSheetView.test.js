import translations from '../../i18n/translations';
import {
    canAddToOrder,
    clampQuantity,
    defaultSelection,
    findOption,
    maxQuantity,
    productSheetView,
    reconcileSelection,
    stockStatusText,
    unitLabel,
    warehouseOption,
} from './productSheetView';

const en = translations.en;

const VAKE = {warehouse: 'W1', warehouse_name: 'Vake', quantity: '12.000', reserve: '2.000', price: '89.90'};
const CENTRAL = {warehouse: 'W2', warehouse_name: 'Central', quantity: '3.000', price: '89.90'};
const EMPTY_MINE = {warehouse: 'W3', warehouse_name: 'Saburtalo', quantity: '0.000', price: '89.90'};
const OTHER = {warehouse: 'W9', warehouse_name: 'Batumi', quantity: '7.000', price: '95.00'};

const view = (overrides = {}) => productSheetView({
    balances: [VAKE, CENTRAL, EMPTY_MINE, OTHER],
    userWarehouseNames: ['Vake', 'Central', 'Saburtalo'],
    stockBlocked: false,
    searchedAllWarehouses: true,
    hasLastSearch: true,
    basePrice: '89.90',
    ...overrides,
});

describe('warehouseOption', () => {
    it('reads free stock, reserve, level and meter width', () => {
        const option = warehouseOption(VAKE, '89.90');
        expect(option).toMatchObject({
            code: 'W1', name: 'Vake', qty: 12, reserve: 2, hasReserve: true,
            level: 'in', fillPercent: 80, selectable: true, showPrice: false,
        });
        expect(warehouseOption(CENTRAL, '89.90')).toMatchObject({level: 'low', fillPercent: 20});
        expect(warehouseOption(EMPTY_MINE, '89.90')).toMatchObject({level: 'out', fillPercent: 0, selectable: false});
    });

    it('caps the meter at a full bar', () => {
        expect(warehouseOption({...VAKE, quantity: '40.000'}, '89.90').fillPercent).toBe(100);
    });

    it('repeats the price only when it differs, is discounted, or the product has none', () => {
        expect(warehouseOption(OTHER, '89.90').showPrice).toBe(true);
        expect(warehouseOption({...VAKE, discount_percent: '10.00'}, '89.90').showPrice).toBe(true);
        expect(warehouseOption(VAKE, '').showPrice).toBe(true);
        expect(warehouseOption({...VAKE, price: null}, '').showPrice).toBe(false);
    });
});

describe('productSheetView', () => {
    it('splits my warehouses from the others by name', () => {
        const result = view();
        expect(result.groupedByMine).toBe(true);
        expect(result.primary.map((o) => o.code)).toEqual(['W1', 'W2', 'W3']);
        expect(result.others.map((o) => o.code)).toEqual(['W9']);
        expect(result.notice).toBeNull();
    });

    it('lists every balance as one group for a user with no assigned warehouses', () => {
        const result = view({userWarehouseNames: []});
        expect(result.groupedByMine).toBe(false);
        expect(result.primary).toHaveLength(4);
        expect(result.others).toEqual([]);
        expect(result.othersToggle).toBe('hidden');
    });

    it('shows no rows and a blocked notice when stock cannot be trusted', () => {
        const result = view({stockBlocked: true});
        expect(result.notice).toBe('blocked');
        expect(result.primary).toEqual([]);
        expect(result.others).toEqual([]);
        expect(result.othersToggle).toBe('hidden');
    });

    it('says so when the lookup returned no balances', () => {
        expect(view({balances: []}).notice).toBe('empty');
    });

    it('offers to fetch other warehouses before they were requested', () => {
        expect(view({balances: [VAKE], searchedAllWarehouses: false}).othersToggle).toBe('fetch');
    });

    it('keeps the toggle after fetching only while there are other warehouses', () => {
        expect(view().othersToggle).toBe('fetched');
        expect(view({balances: [VAKE, CENTRAL]}).othersToggle).toBe('hidden');
    });

    it('has no toggle without a lookup to re-run', () => {
        expect(view({hasLastSearch: false, searchedAllWarehouses: false}).othersToggle).toBe('hidden');
    });
});

describe('selection', () => {
    it('defaults to the first of my warehouses with stock', () => {
        expect(defaultSelection(view({balances: [EMPTY_MINE, CENTRAL, VAKE, OTHER]}))).toBe('W2');
    });

    it('selects nothing when none of my warehouses has stock, even if others do', () => {
        expect(defaultSelection(view({balances: [EMPTY_MINE, OTHER]}))).toBeNull();
    });

    it('defaults to the first balance with stock for a user with no assigned warehouses', () => {
        expect(defaultSelection(view({userWarehouseNames: [], balances: [EMPTY_MINE, OTHER]}))).toBe('W9');
    });

    it('keeps a pick that is still selectable and drops one that is not', () => {
        expect(reconcileSelection('W9', view())).toBe('W9');
        expect(reconcileSelection('W9', view({balances: [VAKE]}))).toBe('W1');
        expect(reconcileSelection('W3', view())).toBe('W1');
        expect(reconcileSelection(null, view())).toBe('W1');
    });

    it('finds an option by code across both groups', () => {
        expect(findOption(view(), 'W9').name).toBe('Batumi');
        expect(findOption(view(), 'nope')).toBeNull();
        expect(findOption(view(), null)).toBeNull();
    });
});

describe('quantity', () => {
    const vake = warehouseOption(VAKE, '89.90');
    const empty = warehouseOption(EMPTY_MINE, '89.90');

    it('allows up to the free stock of the selected warehouse', () => {
        expect(maxQuantity(vake)).toBe(12);
        expect(maxQuantity(empty)).toBe(0);
        expect(maxQuantity(null)).toBe(0);
    });

    it('clamps to one through the free stock', () => {
        expect(clampQuantity(20, vake)).toBe(12);
        expect(clampQuantity(0, vake)).toBe(1);
        expect(clampQuantity(3, null)).toBe(1);
    });

    it('can add only a quantity the selected warehouse can supply', () => {
        expect(canAddToOrder(vake, 12)).toBe(true);
        expect(canAddToOrder(vake, 13)).toBe(false);
        expect(canAddToOrder(empty, 1)).toBe(false);
        expect(canAddToOrder(null, 1)).toBe(false);
    });
});

describe('stockStatusText', () => {
    it('describes each level in words', () => {
        expect(stockStatusText(warehouseOption(VAKE, '89.90'), en)).toBe('In stock · 12 free · 2 reserved');
        expect(stockStatusText(warehouseOption(CENTRAL, '89.90'), en)).toBe('Low stock · 3 free');
        expect(stockStatusText(warehouseOption({...EMPTY_MINE, reserve: '4.000'}, '89.90'), en))
            .toBe('Out of stock · 4 reserved');
    });
});

describe('unitLabel', () => {
    it('translates a known unit and passes an unknown one through', () => {
        expect(unitLabel('piece', en)).toBe('Piece');
        expect(unitLabel('crate', en)).toBe('crate');
        expect(unitLabel('', en)).toBe('');
    });
});

import {warehouseRowView} from './warehouseRowView';

// Stock meter scale and the "low stock" line, unchanged from the product
// result page this sheet replaces.
export const LOW_STOCK_THRESHOLD = 5;
export const MAX_STOCK_FOR_FULL_BAR = 15;

export const stockLevel = (qty) => {
    if (qty <= 0) return 'out';
    if (qty <= LOW_STOCK_THRESHOLD) return 'low';
    return 'in';
};

const asNumber = (value) => (value == null || value === '' ? null : Number(value));

/**
 * One warehouse row of the product sheet. A row can be picked for the order
 * when its FREE quantity is above zero — the rule the per-row add buttons and
 * the quantity sheet used, for my warehouses and other warehouses alike.
 * `showPrice` is set when the row's price is worth repeating under the
 * product's own price: a discount, a different price, or no product price.
 */
export const warehouseOption = (balance, basePrice) => {
    const view = warehouseRowView(balance);
    const price = asNumber(balance.price);
    const base = asNumber(basePrice);
    return {
        key: `${balance.warehouse}-${balance.warehouse_name}`,
        code: balance.warehouse,
        name: balance.warehouse_name,
        price: balance.price,
        qty: view.qty,
        reserve: view.reserve,
        hasReserve: view.hasReserve,
        level: stockLevel(view.qty),
        fillPercent: Math.min(100, Math.round((view.qty / MAX_STOCK_FOR_FULL_BAR) * 100)),
        selectable: view.qty > 0,
        hasDiscount: view.hasDiscount,
        discountedPrice: view.discountedPrice,
        discountPercent: view.discountPercent,
        showPrice: price != null && (view.hasDiscount || base == null || price !== base),
    };
};

/**
 * What the product sheet lists.
 *
 * - `notice`: 'blocked' when the balances cannot be trusted (stock_status is
 *   set; no rows then), 'empty' when the lookup returned no balance at all.
 * - `groupedByMine`: the user has assigned warehouses, so `primary` is "my
 *   warehouses" and `others` the rest; without assignments `primary` is every
 *   balance, as the result page listed them.
 * - `othersToggle`: 'hidden', 'fetch' (other warehouses not requested yet) or
 *   'fetched'. Same rule as the old button: only with assigned warehouses and
 *   a lookup to re-run, and only while there is something left to fetch or
 *   fetched rows to show.
 */
export const productSheetView = ({
    balances,
    userWarehouseNames,
    stockBlocked,
    searchedAllWarehouses,
    hasLastSearch,
    basePrice,
}) => {
    const names = userWarehouseNames || [];
    const groupedByMine = names.length > 0;
    if (stockBlocked) {
        return {notice: 'blocked', groupedByMine, primary: [], others: [], othersToggle: 'hidden'};
    }
    const list = balances || [];
    const isMine = (balance) => names.includes(balance.warehouse_name);
    const toOption = (balance) => warehouseOption(balance, basePrice);
    const primary = (groupedByMine ? list.filter(isMine) : list).map(toOption);
    const others = groupedByMine ? list.filter((balance) => !isMine(balance)).map(toOption) : [];
    const toggleVisible = groupedByMine && hasLastSearch && (!searchedAllWarehouses || others.length > 0);
    let othersToggle = 'hidden';
    if (toggleVisible) othersToggle = searchedAllWarehouses ? 'fetched' : 'fetch';
    return {
        notice: list.length === 0 ? 'empty' : null,
        groupedByMine,
        primary,
        others,
        othersToggle,
    };
};

const allOptions = (view) => [...view.primary, ...view.others];

export const findOption = (view, code) => (
    code == null ? null : allOptions(view).find((option) => option.code === code) || null
);

/** The first warehouse in the primary list with free stock, else none. */
export const defaultSelection = (view) => {
    const first = view.primary.find((option) => option.selectable);
    return first ? first.code : null;
};

/**
 * Keep the user's pick while it is still selectable — re-fetching other
 * warehouses rebuilds every row — otherwise fall back to the default.
 */
export const reconcileSelection = (code, view) => {
    const option = findOption(view, code);
    return option && option.selectable ? code : defaultSelection(view);
};

/** Upper bound for the stepper: the selected warehouse's free quantity. */
export const maxQuantity = (option) => (option && option.selectable ? option.qty : 0);

export const clampQuantity = (quantity, option) => {
    const max = maxQuantity(option);
    if (max <= 0) return 1;
    return Math.min(max, Math.max(1, Math.floor(Number(quantity) || 1)));
};

export const canAddToOrder = (option, quantity) => {
    const max = maxQuantity(option);
    return max > 0 && quantity >= 1 && quantity <= max;
};

/** "In stock · 12 free · 2 reserved" — words next to the meter, never colour alone. */
export const stockStatusText = (option, t) => {
    const parts = [];
    if (option.level === 'out') {
        parts.push(t.outOfStock);
    } else {
        parts.push(option.level === 'low' ? t.lowStock : t.stockInStock, t.stockFree(option.qty));
    }
    if (option.hasReserve) parts.push(t.stockReserved(option.reserve));
    return parts.join(' · ');
};

/** Display label for a unit code ("piece" → "ცალი"), or the code itself. */
export const unitLabel = (unit, t) => (
    unit ? (t.unitOptions?.find((opt) => opt.value === unit)?.label || unit) : ''
);

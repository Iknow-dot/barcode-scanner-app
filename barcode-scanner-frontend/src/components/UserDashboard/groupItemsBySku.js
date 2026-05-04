/**
 * Reduce a flat list of PurchaseOrderItems into an array of group objects
 * keyed by `sku`. A group is purely a UI projection — the underlying rows
 * are unchanged.
 *
 * Decimal-typed fields (price, discount_percent, discounted_price,
 * effective_price, line_total) arrive from DRF as strings. Comparisons in
 * this module are done as strings to avoid floating-point drift; sums are
 * done by parsing to Number then re-formatting to two decimals on output.
 */

const allEqual = (arr) => arr.every((v) => v === arr[0]);

const fmt = (n) => Number(n).toFixed(2);

const sum = (items, key) =>
    items.reduce((acc, it) => acc + Number(it[key] || 0), 0);

const minMax = (items, key) => {
    const nums = items.map((it) => Number(it[key] || 0));
    return [fmt(Math.min(...nums)), fmt(Math.max(...nums))];
};

const groupItemsBySku = (items) => {
    if (!Array.isArray(items) || items.length === 0) return [];

    // Preserve insertion order — first time we see a SKU defines its slot.
    const order = [];
    const groups = new Map();

    for (const it of items) {
        if (!groups.has(it.sku)) {
            order.push(it.sku);
            groups.set(it.sku, []);
        }
        groups.get(it.sku).push(it);
    }

    return order.map((sku) => {
        const lines = groups.get(sku);
        const first = lines[0];

        const effectivePrices = lines.map((l) => l.effective_price);
        const isMixedPrice = !allEqual(effectivePrices);
        const sharedPrice = isMixedPrice ? null : effectivePrices[0];
        const [minPrice, maxPrice] = minMax(lines, 'effective_price');

        const discountSignatures = lines.map((l) => `${l.discount_percent}|${l.discounted_price ?? ''}`);
        const isMixedDiscount = !allEqual(discountSignatures);
        const sharedDiscountPercent = isMixedDiscount ? null : lines[0].discount_percent;
        const sharedDiscountedPrice = isMixedDiscount ? null : lines[0].discounted_price;

        const units = lines.map((l) => l.unit || '');
        const isMixedUnit = !allEqual(units);
        const sharedUnit = isMixedUnit ? null : units[0];

        return {
            sku,
            sku_name: first.sku_name,
            article: first.article,
            items: lines,
            sharedPrice,
            minPrice,
            maxPrice,
            isMixedPrice,
            sharedDiscountPercent,
            sharedDiscountedPrice,
            isMixedDiscount,
            sharedUnit,
            isMixedUnit,
            totalQty: lines.reduce((acc, l) => acc + Number(l.quantity || 0), 0),
            groupLineTotal: fmt(sum(lines, 'line_total')),
        };
    });
};

export default groupItemsBySku;

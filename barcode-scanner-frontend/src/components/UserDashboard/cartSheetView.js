import groupItemsBySku from './groupItemsBySku';
import {pairGiftLines} from './giftSplit';

/**
 * The cart as the order sheet lists it: one section per warehouse, in the
 * order warehouses first appear in the order. Inside a section the lines are
 * grouped by SKU (groupItemsBySku) and each product's paid and gift lines are
 * paired into one visual row (pairGiftLines), as the per-product card did.
 */
export const cartSections = (items) => {
    const list = Array.isArray(items) ? items : [];
    const codes = [];
    const byWarehouse = new Map();
    list.forEach((item) => {
        const code = item.warehouse_code || '';
        if (!byWarehouse.has(code)) {
            codes.push(code);
            byWarehouse.set(code, []);
        }
        byWarehouse.get(code).push(item);
    });
    return codes.map((code) => {
        const sectionItems = byWarehouse.get(code);
        const rows = groupItemsBySku(sectionItems).flatMap((group) => (
            pairGiftLines(group.items).map((row) => ({
                ...row,
                key: `${group.sku}:${row.key}`,
                sku: group.sku,
                article: group.article,
            }))
        ));
        return {
            key: code || '—',
            warehouseName: sectionItems[0].warehouse_name || code,
            rows,
        };
    });
};

const quantityOf = (item) => Number(item.quantity || 0);

/** Units in the order ("Total · 4 pcs"), gifts included. */
export const cartItemCount = (items) => (
    (Array.isArray(items) ? items : []).reduce((sum, item) => sum + quantityOf(item), 0)
);

/** Units marked as gifts. */
export const cartGiftCount = (items) => (
    (Array.isArray(items) ? items : []).reduce((sum, item) => sum + (item.is_gift ? quantityOf(item) : 0), 0)
);

/** Distinct warehouse names, in order of first appearance. */
export const orderWarehouseNames = (items) => [
    ...new Set((Array.isArray(items) ? items : []).map((item) => item.warehouse_name).filter(Boolean)),
];

// Uppercase a letter, except Georgian: toUpperCase() turns Mkhedruli (the
// script Georgian is written in) into Mtavruli capitals, which are not used
// for initials.
const initial = (word) => {
    const letter = word.charAt(0);
    const upper = letter.toUpperCase();
    return /[Ა-Ჿ]/.test(upper) ? letter : upper;
};

/** Avatar initials: the first letter of the first two words. */
export const customerInitials = (name) => (
    (name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(initial).join('')
);

const isPendingLine = (line) => Boolean(line) && (line._pending === true || String(line.id).startsWith('tmp_'));

/**
 * Display and edit model for one cart row. The anchor line carries price and
 * discount edits and quantity growth: the paid line when there is one,
 * otherwise the gift line. The minimum total keeps every gift unit plus one
 * paid unit (gifts shrink through the gift stepper instead).
 */
export const cartRowView = (row) => {
    const anchor = row.paid ?? row.gift;
    return {
        anchor,
        name: anchor.sku_name || anchor.sku,
        price: anchor.price,
        effectivePrice: anchor.effective_price ?? anchor.price,
        hasDiscount: Boolean(anchor.effective_price)
            && parseFloat(anchor.effective_price) !== parseFloat(anchor.price),
        discountPercent: parseFloat(anchor.discount_percent || 0),
        priceCap: parseFloat(anchor.price || 0),
        lineTotal: (Number(row.paid?.line_total || 0) + Number(row.gift?.line_total || 0)).toFixed(2),
        pending: isPendingLine(row.paid) || isPendingLine(row.gift),
        minQuantity: row.paid ? row.giftQty + 1 : 1,
    };
};

/**
 * The request behind a new row total: the anchor line absorbs the change and
 * the gift count stays. null when the total would drop below one paid unit.
 */
export const planQuantityChange = (row, newTotal) => {
    if (newTotal < 1) return null;
    const target = row.paid ?? row.gift;
    const quantity = newTotal - (row.paid ? row.giftQty : 0);
    if (quantity < 1) return null;
    return {itemId: target.id, data: {quantity}};
};

/** A manual price replaces any percent discount, and the reverse. */
export const pricePatch = (value) => ({discounted_price: value == null ? null : value, discount_percent: 0});
export const discountPatch = (value) => ({discount_percent: value == null ? 0 : value, discounted_price: null});

export const exceedsStock = (row, stock) => Number.isFinite(stock) && Number(row.totalQty) > Number(stock);

/** Navbar of the order sheet for each of its two steps. */
export const orderStepHeader = (step, t) => (
    step === 2
        ? {title: t.stepDelivery, subtitle: '2 / 2', leading: 'back'}
        : {title: t.cart, subtitle: `1 / 2 · ${t.stepProducts}`, leading: 'close'}
);

export const hasOrderItems = (order) => Array.isArray(order?.items) && order.items.length > 0;

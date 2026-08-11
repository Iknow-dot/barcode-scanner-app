/**
 * A "partial gift" is represented as two PurchaseOrderItem lines with the
 * same SKU + warehouse — one paid, one is_gift (the backend's add_item
 * merge is is_gift-aware, so the two lines coexist). This module pairs
 * those lines back into single visual rows and plans the API operations
 * needed to move units between the two lines.
 *
 * Op ordering rule: the growing side changes first, so a mid-sequence
 * failure leaves a visible surplus in the cart rather than silently
 * dropping units.
 */
import {orderService} from '../../api';

export const pairGiftLines = (items) => {
    const rows = [];
    const byCode = new Map(); // warehouse_code -> primary row (still pairable)
    for (const it of items) {
        const code = it.warehouse_code || '';
        const slot = it.is_gift ? 'gift' : 'paid';
        const existing = byCode.get(code);
        if (existing && existing[slot] === null) {
            existing[slot] = it;
            continue;
        }
        const row = {
            key: existing ? `line-${it.id}` : `wh-${code}`,
            warehouse_code: code,
            warehouse_name: it.warehouse_name,
            paid: null,
            gift: null,
        };
        row[slot] = it;
        rows.push(row);
        // Duplicate same-class lines (possible via bulk admin edits) get
        // standalone rows; only the first row per warehouse keeps pairing.
        if (!existing) byCode.set(code, row);
    }
    return rows.map((row) => {
        const paidQty = Number(row.paid?.quantity || 0);
        const giftQty = Number(row.gift?.quantity || 0);
        return {...row, totalQty: paidQty + giftQty, giftQty};
    });
};

// Fields copied onto the new line when a split creates one. Discounts are
// deliberately NOT copied — they stay on the paid line.
const copyLineFields = (item) => ({
    sku: item.sku,
    sku_name: item.sku_name,
    article: item.article,
    price: item.price,
    warehouse_code: item.warehouse_code,
    warehouse_name: item.warehouse_name,
    unit: item.unit,
});

export const planGiftChange = (row, targetGift) => {
    const {paid, gift, totalQty, giftQty} = row;
    const target = Math.max(0, Math.min(totalQty, targetGift));
    if (target === giftQty) return [];

    if (target === 0) {
        if (paid && gift) {
            return [
                {op: 'update', itemId: paid.id, data: {quantity: totalQty}},
                {op: 'remove', itemId: gift.id},
            ];
        }
        return [{op: 'update', itemId: gift.id, data: {is_gift: false}}];
    }

    if (target === totalQty) {
        if (paid && gift) {
            return [
                {op: 'update', itemId: gift.id, data: {quantity: totalQty}},
                {op: 'remove', itemId: paid.id},
            ];
        }
        return [{op: 'update', itemId: paid.id, data: {is_gift: true}}];
    }

    // 0 < target < totalQty — both sides will exist afterwards.
    if (paid && gift) {
        const giftOp = {op: 'update', itemId: gift.id, data: {quantity: target}};
        const paidOp = {op: 'update', itemId: paid.id, data: {quantity: totalQty - target}};
        return target > giftQty ? [giftOp, paidOp] : [paidOp, giftOp];
    }
    if (paid) {
        return [
            {op: 'add', data: {...copyLineFields(paid), quantity: target, is_gift: true}},
            {op: 'update', itemId: paid.id, data: {quantity: totalQty - target}},
        ];
    }
    return [
        {op: 'add', data: {...copyLineFields(gift), quantity: totalQty - target, is_gift: false}},
        {op: 'update', itemId: gift.id, data: {quantity: target}},
    ];
};

export const applyGiftOps = async (orderId, ops) => {
    let last = null;
    for (const step of ops) {
        let result;
        if (step.op === 'add') result = await orderService.addOrderItem(orderId, step.data);
        else if (step.op === 'update') result = await orderService.updateOrderItem(orderId, step.itemId, step.data);
        else result = await orderService.removeOrderItem(orderId, step.itemId);
        if (!result.success) return result;
        last = result;
    }
    return last ?? {success: true, data: null};
};

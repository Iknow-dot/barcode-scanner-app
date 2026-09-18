import React, {memo, useCallback, useState} from 'react';
import {Input} from 'antd';
import {orderService} from '../../api';
import {useLanguage} from '../../i18n/LanguageContext';
import IosIcon from '../Common/IosIcon';
import QuantityStepper from '../Common/QuantityStepper';
import GiftCounter from './GiftCounter';
import {applyGiftOps, planGiftChange} from './giftSplit';
import {unitLabel} from './productSheetView';
import {
    cartRowView,
    discountPatch,
    exceedsStock,
    planQuantityChange,
    pricePatch,
} from './cartSheetView';

/**
 * One product in one warehouse on the cart sheet: its paid and gift lines
 * shown as a single row (see cartSheetView). Every control keeps the request
 * the old cart table row made: quantity through the anchor line, gifts
 * through planGiftChange, delete removes both lines, and the price and
 * discount editor — for users allowed to discount — sends the same patches.
 */
const CartItemRow = ({
    row,
    stock,
    orderId,
    onOrderUpdate,
    notify,
    canApplyDiscount,
    maxDiscountPercent,
    giftEnabled,
}) => {
    const {t} = useLanguage();
    const [editing, setEditing] = useState(false);
    // Guards the quantity stepper, the gift pill and delete against a second
    // tap while one of their requests is in flight — two quick taps would
    // otherwise both compute their target from the same stale prop (F3).
    const [busy, setBusy] = useState(false);
    const view = cartRowView(row);
    const unit = unitLabel(view.anchor.unit, t);

    const report = useCallback((result) => {
        if (result.success) onOrderUpdate(result.data);
        else notify.error(t.orderError, result.error);
    }, [onOrderUpdate, notify, t]);

    const runBusy = useCallback(async (action) => {
        setBusy(true);
        try {
            await action();
        } finally {
            setBusy(false);
        }
    }, []);

    const handleQuantityChange = (newTotal) => {
        const plan = planQuantityChange(row, newTotal);
        if (!plan) return;
        runBusy(async () => {
            report(await orderService.updateOrderItem(orderId, plan.itemId, plan.data));
        });
    };

    const handleGiftChange = (targetGift) => {
        const ops = planGiftChange(row, targetGift);
        if (ops.length === 0) return;
        runBusy(async () => {
            report(await applyGiftOps(orderId, ops));
        });
    };

    const handleRemove = () => runBusy(async () => {
        // Remove BOTH physical lines behind this visual row.
        const ids = [row.paid?.id, row.gift?.id].filter(Boolean);
        let last = null;
        for (const id of ids) {
            const result = await orderService.removeOrderItem(orderId, id);
            if (!result.success) {
                notify.error(t.orderError, result.error);
                return;
            }
            last = result;
        }
        if (last) onOrderUpdate(last.data);
    });

    const savePrice = async (event) => {
        const value = parseFloat(event.target.value);
        const next = Number.isFinite(value) ? value : null;
        if (next === parseFloat(view.effectivePrice)) return;
        report(await orderService.updateOrderItem(orderId, view.anchor.id, pricePatch(next)));
    };

    const saveDiscount = async (event) => {
        const value = parseFloat(event.target.value);
        let next = Number.isFinite(value) ? value : null;
        // F7: InputNumber's min={0} (and the already-ruled-out max) went with
        // it when it was removed — unlike price, the server sets no
        // min_value on discount_percent either, so a negative value would
        // otherwise persist untouched. Clamp to [0, maxDiscountPercent]
        // before sending; only the over-the-cap direction has a real server
        // error to mirror (core/views/orders.py's DISCOUNT_EXCEEDS_LIMIT), so
        // only that direction shows a message — flooring a negative value to
        // 0 is just the natural minimum, not a limit being hit.
        if (next !== null) {
            if (next > maxDiscountPercent) notify.error(t.orderError, t.discountExceedsLimit(maxDiscountPercent));
            next = Math.min(Math.max(next, 0), maxDiscountPercent);
        }
        if ((next ?? 0) === view.discountPercent) return;
        report(await orderService.updateOrderItem(orderId, view.anchor.id, discountPatch(next)));
    };

    const priceText = (
        <>
            {view.hasDiscount && <s className="m-cart-item-was">{view.price} ₾</s>}
            {`${view.effectivePrice} ₾`}
            {unit && ` / ${unit}`}
            {view.discountPercent > 0 && ` · −${view.discountPercent}%`}
        </>
    );

    const over = exceedsStock(row, stock);

    return (
        <div className={`if-row m-cart-item${view.pending ? ' is-pending' : ''}`}>
            <span className="if-row-thumb" aria-hidden="true">
                <IosIcon name="package" size={26} stroke={1.8}/>
            </span>
            <div className="if-row-main">
                <div className="m-cart-item-head">
                    <span className="if-row-title if-clamp-2">{view.name}</span>
                    <span className="m-cart-item-total">{view.lineTotal} ₾</span>
                </div>
                {canApplyDiscount ? (
                    <button
                        type="button"
                        className="m-cart-item-price is-editable"
                        aria-expanded={editing}
                        aria-label={`${t.overridePrice}: ${view.effectivePrice} ₾`}
                        onClick={() => setEditing((open) => !open)}
                    >
                        {priceText}
                        <IosIcon name="chev" size={12} stroke={2.6}/>
                    </button>
                ) : (
                    <div className="m-cart-item-price">{priceText}</div>
                )}
                {canApplyDiscount && editing && (
                    <div className="m-cart-item-editor">
                        <label className="m-cart-item-field">
                            <span className="if-field-label">{t.price}</span>
                            <span className="m-cart-item-field-input">
                                <Input
                                    key={`price-${view.effectivePrice}`}
                                    variant="borderless"
                                    className="if-field-input"
                                    aria-label={t.price}
                                    inputMode="decimal"
                                    defaultValue={view.effectivePrice}
                                    onPressEnter={(event) => event.currentTarget.blur()}
                                    onBlur={savePrice}
                                />
                                <span className="m-cart-item-field-unit" aria-hidden="true">₾</span>
                            </span>
                        </label>
                        <label className="m-cart-item-field">
                            <span className="if-field-label">{t.discountPercent}</span>
                            <span className="m-cart-item-field-input">
                                <Input
                                    key={`discount-${view.discountPercent}`}
                                    variant="borderless"
                                    className="if-field-input"
                                    aria-label={t.discountPercent}
                                    inputMode="decimal"
                                    defaultValue={String(view.discountPercent || 0)}
                                    onPressEnter={(event) => event.currentTarget.blur()}
                                    onBlur={saveDiscount}
                                />
                                <span className="m-cart-item-field-unit" aria-hidden="true">%</span>
                            </span>
                        </label>
                    </div>
                )}
                {(Number.isFinite(stock) || view.pending) && (
                    <div className="m-cart-item-captions">
                        {Number.isFinite(stock) && (
                            over ? (
                                <span className="m-cart-item-warning">
                                    <IosIcon name="warn" size={14} stroke={2.4}/>
                                    {t.exceedsStock(stock)}
                                </span>
                            ) : (
                                <span>{t.stockRemaining}: {stock}</span>
                            )
                        )}
                        {view.pending && (
                            <span className="m-cart-item-pending">
                                <IosIcon name="cloud" size={14} stroke={2.2}/>
                                {t.offlineItemPending}
                            </span>
                        )}
                    </div>
                )}
                <div className="m-cart-item-controls">
                    <QuantityStepper
                        value={row.totalQty}
                        min={view.minQuantity}
                        onChange={handleQuantityChange}
                        disabled={busy}
                        label={t.quantity}
                        decrementLabel={t.decreaseQuantity}
                        incrementLabel={t.increaseQuantity}
                        iconSize={18}
                    />
                    <GiftCounter
                        enabled={giftEnabled}
                        totalQty={row.totalQty}
                        giftQty={row.giftQty}
                        label={t.giftLabel}
                        onChange={handleGiftChange}
                        disabled={busy}
                    />
                    {/* F3: delete used to take the minus button's exact slot
                        at totalQty === 1 — a consultant correcting a
                        quantity down (3 → 2 → 1) could have their next tap
                        land on a control that had just become a trash can in
                        the same spot, instantly removing the whole line
                        (paid and gift together) with no message. It is now
                        its own persistent, visually separated control,
                        offered at any quantity rather than only at the
                        minimum — the minus button just disables at the
                        floor instead, like QuantityStepper does everywhere
                        else it's used. */}
                    <button
                        type="button"
                        className="if-stepper-btn m-cart-item-delete"
                        aria-label={t.delete}
                        disabled={busy}
                        onClick={handleRemove}
                    >
                        <IosIcon name="trash" size={18}/>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default memo(CartItemRow);

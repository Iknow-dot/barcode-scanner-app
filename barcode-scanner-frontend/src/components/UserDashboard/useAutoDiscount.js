import {useEffect, useRef, useState} from 'react';
import {orderService} from '../../api';
import {isOffline, subscribe} from '../../utils/connectivity';
import {isTempId} from '../../utils/offlineOrderQueue';

export const AUTO_DISCOUNT_DEBOUNCE_MS = 800;

// What 1C's answer depends on: the client it is priced for (1C picks the
// discount by client, and refuses without one) and the lines.
// auto_discount_percent is left out on purpose: the answer itself changes
// it, and including it would ask again forever.
const cartSignature = (order) => [
    [order?.customer_identification_number, order?.customer_phone, order?.is_retail].join('|'),
    ...(order?.items || []).map((i) => [
        i.id, i.sku, i.article, i.quantity, i.price, i.discount_percent,
        i.discounted_price, i.is_gift, i.warehouse_code,
    ].join('|')),
].join(';');

/**
 * 1C's automatic discount for the open cart (core/services/auto_discount.py):
 * one request per burst of edits, AUTO_DISCOUNT_DEBOUNCE_MS after the last.
 * Only for a draft whose lines are all on the server (a tmp_ line is not),
 * only online (utils/connectivity; coming back online asks again), and only
 * while the sheet is open and the org has the switch on. An answer
 * a newer edit overtook, or that orderService marks stale, is dropped — the
 * newer edit asks again. The confirm recalculates on the server regardless,
 * so a dropped or failed preview can never mis-price an order.
 *
 * Returns `{unavailable}`: the last request failed, so the prices shown may
 * be missing 1C's discount.
 */
const useAutoDiscount = ({order, active, enabled, onOrder, delayMs = AUTO_DISCOUNT_DEBOUNCE_MS}) => {
    const [unavailable, setUnavailable] = useState(false);
    const onOrderRef = useRef(onOrder);
    onOrderRef.current = onOrder;
    const ticketRef = useRef(0);
    const [offline, setOffline] = useState(isOffline);

    useEffect(() => {
        setOffline(isOffline());
        return subscribe(setOffline);
    }, []);

    const items = order?.items || [];
    const signature = cartSignature(order);
    const orderId = order?.id;
    const eligible = Boolean(active && enabled && !offline && orderId && order?.status === 'draft'
        && items.length > 0 && !items.some((i) => isTempId(i.id) || i._pending));

    useEffect(() => {
        if (!active) setUnavailable(false);
    }, [active]);

    useEffect(() => {
        const ticket = ++ticketRef.current;
        if (!eligible) {
            // The failure no longer describes this cart (offline, a pending
            // line, closed…); the notice must not outlive its cause.
            setUnavailable(false);
            return undefined;
        }
        const timer = setTimeout(async () => {
            const result = await orderService.autoDiscount(orderId);
            if (ticket !== ticketRef.current || result.stale) return;
            if (result.success) {
                setUnavailable(false);
                onOrderRef.current(result.data);
            } else {
                setUnavailable(true);
            }
        }, delayMs);
        return () => clearTimeout(timer);
    }, [eligible, orderId, signature, delayMs]);

    return {unavailable};
};

export default useAutoDiscount;

import React, {useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {DeleteOutlined, SaveOutlined, UserSwitchOutlined} from '@ant-design/icons';
import AuthContext from '../Auth/AuthContext';
import {useLanguage} from '../../i18n/LanguageContext';
import displayCustomerName from '../../utils/orderDisplay';
import IosActionSheet from '../Common/IosActionSheet';
import IosIcon from '../Common/IosIcon';
import IosSheet from '../Common/IosSheet';
import CartItemRow from './CartItemRow';
import DeliveryStep from './DeliveryStep';
import OfflineBanner from './OfflineBanner';
import useSkuStock from './useSkuStock';
import {
    cartGiftCount,
    cartItemCount,
    cartSections,
    customerInitials,
    hasOrderItems,
    orderStepHeader,
    pooledStockDemand,
} from './cartSheetView';

// Whether `element` is a text field in the cart's rows (`cart`).
const isCartField = (cart, element) => Boolean(
    cart && element && cart.contains(element) && element.matches('input, textarea'),
);

/**
 * The active order as a two-step sheet: the cart (step 1: client, products
 * by warehouse, Next) and delivery (step 2: delivery details, summary,
 * Confirm). Save for later, change customer and delete order live in the
 * cart's ⋯ menu.
 *
 * Like OrderPanel before it, the sheet keeps the order in LOCAL state and
 * reports edits to the dashboard through onOrderUpdate (which only updates a
 * ref), so an edit does not re-render the dashboard. Every opening starts
 * again from the dashboard's order on step 1, and every new order the
 * dashboard hands it while open replaces the local one, once no cart field
 * is being typed in (see the sync effect).
 */
const OrderSheet = ({
    open,
    order,
    onClose,
    onOrderUpdate,
    onSaveForLater,
    onProceedToPayment,
    onDeleteOrder,
    onChangeCustomer,
    notify,
    confirmDisabled,
    onOfflineDiscard,
}) => {
    const {t} = useLanguage();
    const {authData} = useContext(AuthContext);
    const discountConfig = useMemo(() => ({
        canApplyDiscount: !!authData?.user?.can_apply_discount,
        maxDiscountPercent: parseFloat(authData?.user?.max_discount_percent || 0),
        giftEnabled: !!authData?.gift_marking_enabled,
    }), [authData?.user?.can_apply_discount, authData?.user?.max_discount_percent,
         authData?.gift_marking_enabled]);

    const [localOrder, setLocalOrder] = useState(order);
    const [step, setStep] = useState(1);
    // The cart's ⋯ menu, an IosActionSheet stacked over this sheet (level 1).
    const [menuOpen, setMenuOpen] = useState(false);
    // F1: the in-flight guard for Confirm. The removed Popconfirm used to be
    // the de-facto double-submit guard (its Yes button unmounted on tap, so
    // a second tap hit nothing) and nothing replaced it — there is no
    // server-side lock either (core/views/orders.py's plain get_object(), no
    // select_for_update), so two taps during a slow fail-closed 1C push
    // could create two real orders for one cart. Cleared in handleConfirm's
    // `finally` — clearing only on success would wedge the button shut after
    // a failed confirm, which this project has shipped twice before.
    const [confirming, setConfirming] = useState(false);
    // Loaded by DeliveryStep with a function that flushes its pending
    // debounced fields; called before confirming so a comment typed just
    // before the tap reaches the order ahead of the confirm PATCH, instead
    // of racing the unmount flush against an order already confirmed.
    const deliveryFlushRef = useRef(null);

    const onOrderUpdateRef = useRef(onOrderUpdate);
    onOrderUpdateRef.current = onOrderUpdate;

    // Every NEW `order` object came from outside the sheet, and the sheet
    // takes it whatever changed: the offline drain's refetch (a queued line
    // landing on its server line; or, once an op parks, an order without its
    // edit, since the refetch lays only the ops still queued back over the
    // server's), the re-read after a parked line is discarded, the customer
    // change, the product sheet's add. (It used to take one only when the
    // item count or customer changed, so an update at the same count never
    // reached an open sheet.) The sheet's own edits do not come back this
    // way: onOrderUpdate only moves the dashboard's ref, so between edits
    // `order` stays the object from before them, and a dashboard re-render
    // with that same object is no update. The exception is closing —
    // closeOrderDrawer copies the ref into state, handing back the very
    // object the sheet last published (ownOrderRef): its own edit, not news.
    //
    // So the cart shows what the dashboard's ref holds, whichever order came
    // last: what the order bar shows and every opening starts from. A read
    // the server made before one of the sheet's edits committed, but
    // answered after it, never gets here: orderService.getOrder marks it
    // `stale`, and neither the drain nor the Discard re-read hands it on.
    // That guard belongs where the read is taken, not here: a sheet that
    // ignored an outside order would disagree with the ref.
    //
    // UI state that is not order data stays. An edit still in flight is not
    // in the order yet; its answer lands on top. A delivery field being typed
    // keeps its text (useDebouncedField skips the prop while its timer or save
    // is pending). A cart field being typed holds an outside order back until
    // focus leaves the cart's fields or the step changes (heldOrderRef),
    // because taking it can mount that row afresh (an offline scan's
    // placeholder lands in another warehouse's section, under another key),
    // and React drops the blur that would have saved the typed value. An
    // answer of the sheet's own that lands meanwhile replaces the held order,
    // as it does in the ref. Only another order starts again on step 1.
    const lastOrderIdRef = useRef(order?.id);
    const ownOrderRef = useRef(null);
    const heldOrderRef = useRef(null);
    const cartRef = useRef(null);

    const takeOrder = useCallback((next) => {
        heldOrderRef.current = null;
        setLocalOrder(next);
        if (next?.id !== lastOrderIdRef.current) {
            lastOrderIdRef.current = next?.id;
            setStep(1);
        }
    }, []);

    useEffect(() => {
        if (order === ownOrderRef.current) return;
        if (order?.id === lastOrderIdRef.current && isCartField(cartRef.current, document.activeElement)) {
            heldOrderRef.current = order;
            return;
        }
        takeOrder(order);
    }, [order, takeOrder]);

    const releaseHeldOrder = () => {
        if (heldOrderRef.current) takeOrder(heldOrderRef.current);
    };

    // Focus moving on to another cart field keeps the order held.
    const handleCartBlur = (event) => {
        if (!isCartField(cartRef.current, event.relatedTarget)) releaseHeldOrder();
    };

    const goToStep = (next) => {
        releaseHeldOrder();
        setStep(next);
    };

    // Each opening starts from the dashboard's order, on step 1.
    useEffect(() => {
        if (open) {
            heldOrderRef.current = null;
            setLocalOrder(order);
            lastOrderIdRef.current = order?.id;
            setStep(1);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const handleLocalOrderUpdate = useCallback((updatedOrder) => {
        heldOrderRef.current = null;
        setLocalOrder(updatedOrder);
        ownOrderRef.current = updatedOrder;
        if (onOrderUpdateRef.current) onOrderUpdateRef.current(updatedOrder);
    }, []);

    const items = localOrder?.items;
    const sections = useMemo(() => cartSections(items), [items]);
    // Rows sharing one 1C balance (one article, or duplicate rows of a SKU)
    // warn on their summed units, as the confirm refuses on them.
    const stockDemandOf = useMemo(() => pooledStockDemand(sections), [sections]);
    const {stockBySku, degraded: stockDegraded} = useSkuStock(items, open);

    if (!localOrder) return null;

    const hasItems = hasOrderItems(localOrder);
    const header = orderStepHeader(step, t);
    const giftCount = cartGiftCount(items);

    // Confirming is instant — no popover gate, but the button disables itself
    // for the whole round trip (F1) so a second tap during a slow fail-closed
    // 1C push can't fire a second confirm PATCH. The flush still runs first:
    // a comment typed just before the tap must reach the order ahead of the
    // confirm PATCH (see deliveryFlushRef above), not race the unmount flush
    // against an order already confirmed.
    const handleConfirm = async () => {
        setConfirming(true);
        try {
            if (deliveryFlushRef.current) await deliveryFlushRef.current();
            await onProceedToPayment();
        } finally {
            // A successful confirm unmounts this whole sheet (showOrderPanel
            // goes false in UserDashboard), so this only matters for a
            // failed one — where it must NOT stay disabled, or the
            // consultant can never try again.
            setConfirming(false);
        }
    };

    // Delete is instant too — the swipe/tap into this destructive row IS the
    // deliberate gesture, so selecting it calls onDeleteOrder directly.
    const menuActions = [
        {key: 'save', label: t.saveForLater, icon: <SaveOutlined/>, onSelect: onSaveForLater},
        {key: 'change-customer', label: t.changeCustomer, icon: <UserSwitchOutlined/>, onSelect: onChangeCustomer},
        {key: 'delete', label: t.deleteOrder, icon: <DeleteOutlined/>, destructive: true, onSelect: onDeleteOrder},
    ];

    const trailing = step === 1 ? (
        <button type="button" className="if-glass-btn" aria-label={t.moreActions} onClick={() => setMenuOpen(true)}>
            <IosIcon name="more" size={20}/>
        </button>
    ) : null;

    const total = (
        <span className="if-title-2 if-sheet-total-value">{localOrder.total} ₾</span>
    );

    const bottomBar = step === 1 ? (
        <>
            <div className="if-sheet-total">
                <span className="if-sheet-total-label">
                    {t.cartTotalCount(cartItemCount(items))}
                    {giftCount > 0 && ` · ${giftCount} ${t.giftLabel}`}
                </span>
                {total}
            </div>
            <button
                type="button"
                className="if-btn if-btn-primary"
                disabled={!hasItems}
                onClick={() => goToStep(2)}
            >
                {t.nextStep}
            </button>
        </>
    ) : (
        <>
            <div className="if-sheet-total">
                <span className="if-sheet-total-label">{t.total}</span>
                {total}
            </div>
            <button
                type="button"
                className="if-btn if-btn-primary"
                disabled={!hasItems || confirmDisabled || confirming}
                aria-busy={confirming || undefined}
                onClick={handleConfirm}
            >
                {t.confirmOrder}
            </button>
        </>
    );

    const isRetail = !!localOrder.is_retail;
    const clientName = displayCustomerName(localOrder, t);
    const clientDetails = [localOrder.customer_identification_number, localOrder.customer_phone]
        .filter(Boolean).join(' · ');

    return (
        <>
        <IosSheet
            open={open}
            onClose={onClose}
            title={header.title}
            subtitle={header.subtitle}
            leading={header.leading}
            onBack={() => goToStep(1)}
            trailing={trailing}
            bottomBar={bottomBar}
        >
            <OfflineBanner orderId={localOrder.id} onDiscard={onOfflineDiscard}/>
            {step === 1 ? (
                <>
                    <div className="if-group m-cart-client">
                        <button type="button" className="if-row" onClick={onChangeCustomer}>
                            <span className="m-client-avatar" aria-hidden="true">
                                {isRetail || !customerInitials(clientName)
                                    ? <IosIcon name="person" size={22}/>
                                    : customerInitials(clientName)}
                            </span>
                            <span className="if-row-main">
                                <span className="if-row-title">{clientName || `#${localOrder.id}`}</span>
                                {clientDetails && <span className="if-row-subtitle">{clientDetails}</span>}
                            </span>
                            <span className="if-chev"><IosIcon name="chev" size={16} stroke={2.4}/></span>
                        </button>
                    </div>
                    {/* Inline rather than a toast: this is about what the cart
                        below it shows, and a toast fired mid-cart is both
                        disruptive and easy to miss. Only a RESOLVED request
                        sets this (see useSkuStock), so it never contradicts a
                        row that is simply still waiting for its caption. */}
                    {stockDegraded && (
                        <div className="if-notice is-warning" role="status">
                            <span className="if-notice-icon"><IosIcon name="warn" size={20}/></span>
                            <span>{t.cartStockIncomplete}</span>
                        </div>
                    )}
                    <div ref={cartRef} onBlur={handleCartBlur}>
                        {sections.length === 0 ? (
                            <div className="if-group if-group-empty m-cart-empty">{t.scanToAddProduct}</div>
                        ) : sections.map((section) => (
                            <section key={section.key} aria-label={section.warehouseName}>
                                <h4 className="if-section-header is-split">
                                    <span>{section.warehouseName}</span>
                                    <span>{t.productsInWarehouse(section.rows.length)}</span>
                                </h4>
                                <div className="if-group is-thumb-inset">
                                    {section.rows.map((row) => (
                                        <CartItemRow
                                            key={row.key}
                                            row={row}
                                            stock={stockBySku[row.sku]?.[row.warehouse_code]}
                                            demand={stockDemandOf(row)}
                                            orderId={localOrder.id}
                                            onOrderUpdate={handleLocalOrderUpdate}
                                            notify={notify}
                                            canApplyDiscount={discountConfig.canApplyDiscount}
                                            maxDiscountPercent={discountConfig.maxDiscountPercent}
                                            giftEnabled={discountConfig.giftEnabled}
                                        />
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                </>
            ) : (
                <DeliveryStep
                    order={localOrder}
                    onOrderUpdate={handleLocalOrderUpdate}
                    notify={notify}
                    flushRef={deliveryFlushRef}
                />
            )}
        </IosSheet>
        <IosActionSheet
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            title={t.moreActions}
            actions={menuActions}
            level={1}
        />
        </>
    );
};

export default OrderSheet;

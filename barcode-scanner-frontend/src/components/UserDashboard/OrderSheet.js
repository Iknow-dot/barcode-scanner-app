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
} from './cartSheetView';

const customerKey = (order) => `${order?.external_client_id || ''}|${order?.customer_name || ''}`;

/**
 * The active order as a two-step sheet: the cart (step 1: client, products
 * by warehouse, Next) and delivery (step 2: delivery details, summary,
 * Confirm). Save for later, change customer and delete order live in the
 * cart's ⋯ menu.
 *
 * Like OrderPanel before it, the sheet keeps the order in LOCAL state and
 * reports edits to the dashboard through onOrderUpdate (which only updates a
 * ref), so an edit does not re-render the dashboard. Every opening starts
 * again from the dashboard's order on step 1.
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
    // Loaded by DeliveryStep with a function that flushes its pending
    // debounced fields; called before confirming so a comment typed just
    // before the tap reaches the order ahead of the confirm PATCH, instead
    // of racing the unmount flush against an order already confirmed.
    const deliveryFlushRef = useRef(null);

    const onOrderUpdateRef = useRef(onOrderUpdate);
    onOrderUpdateRef.current = onOrderUpdate;

    // Sync from OUTSIDE (OrderPanel's rules): another order, items added from
    // the product sheet, or the customer changed from the ⋯ menu.
    const lastOrderIdRef = useRef(order?.id);
    const lastItemCountRef = useRef(order?.items?.length || 0);
    const lastCustomerKeyRef = useRef(customerKey(order));

    useEffect(() => {
        if (order?.id !== lastOrderIdRef.current) {
            setLocalOrder(order);
            lastOrderIdRef.current = order?.id;
            lastItemCountRef.current = order?.items?.length || 0;
            lastCustomerKeyRef.current = customerKey(order);
            setStep(1);
            return;
        }
        const itemCount = order?.items?.length || 0;
        if (itemCount !== lastItemCountRef.current) {
            setLocalOrder(order);
            lastItemCountRef.current = itemCount;
        }
        if (customerKey(order) !== lastCustomerKeyRef.current) {
            setLocalOrder(order);
            lastCustomerKeyRef.current = customerKey(order);
        }
    }, [order]);

    // Each opening starts from the dashboard's order, on step 1.
    useEffect(() => {
        if (open) {
            setLocalOrder(order);
            lastOrderIdRef.current = order?.id;
            lastItemCountRef.current = order?.items?.length || 0;
            lastCustomerKeyRef.current = customerKey(order);
            setStep(1);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const handleLocalOrderUpdate = useCallback((updatedOrder) => {
        setLocalOrder(updatedOrder);
        lastItemCountRef.current = updatedOrder?.items?.length || 0;
        if (onOrderUpdateRef.current) onOrderUpdateRef.current(updatedOrder);
    }, []);

    const items = localOrder?.items;
    const sections = useMemo(() => cartSections(items), [items]);
    const stockBySku = useSkuStock(items, open);

    if (!localOrder) return null;

    const hasItems = hasOrderItems(localOrder);
    const header = orderStepHeader(step, t);
    const giftCount = cartGiftCount(items);

    // Confirming is instant — no popover gate. The flush still runs first: a
    // comment typed just before the tap must reach the order ahead of the
    // confirm PATCH (see deliveryFlushRef above), not race the unmount flush
    // against an order already confirmed.
    const handleConfirm = async () => {
        if (deliveryFlushRef.current) await deliveryFlushRef.current();
        onProceedToPayment();
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
                onClick={() => setStep(2)}
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
                disabled={!hasItems || confirmDisabled}
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
            onBack={() => setStep(1)}
            trailing={trailing}
            bottomBar={bottomBar}
        >
            <OfflineBanner orderId={localOrder.id}/>
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
            actions={menuActions}
            level={1}
        />
        </>
    );
};

export default OrderSheet;

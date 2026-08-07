import React, {useState, useCallback, useEffect, useMemo, useRef, useContext, memo} from 'react';
import dayjs from 'dayjs';
import {useLanguage} from '../../i18n/LanguageContext';
import {orderService, productService} from '../../api';
import AuthContext from '../Auth/AuthContext';
import GiftToggleButton from './GiftToggleButton';
import groupItemsBySku from './groupItemsBySku';
import displayCustomerName from '../../utils/orderDisplay';
import {
    Card,
    Steps,
    Tag,
    Typography,
    Flex,
    Button,
    InputNumber,
    Empty,
    Popconfirm,
    Space,
    Badge,
    Radio,
    Input,
    DatePicker,
    TimePicker,
    Collapse,
    Dropdown,
    Modal,
    Segmented,
} from 'antd';
import {
    ShoppingCartOutlined,
    DeleteOutlined,
    UserOutlined,
    UserSwitchOutlined,
    SaveOutlined,
    DollarOutlined,
    CarOutlined,
    ShopOutlined,
    EnvironmentOutlined,
    CommentOutlined,
    MinusOutlined,
    PlusOutlined,
    MoreOutlined,
    WarningOutlined,
    CloudSyncOutlined,
} from '@ant-design/icons';

const {Text, Title} = Typography;
const {TextArea} = Input;

const UNIT_OPTIONS = [
    {label: 'ცალი / pc', value: 'piece'},
    {label: 'ყუთი / box', value: 'box'},
    {label: 'კგ / kg', value: 'kg'},
    {label: 'ლიტრი / L', value: 'liter'},
    {label: 'მეტრი / m', value: 'meter'},
    {label: 'შეკვრა / pack', value: 'pack'},
    {label: 'პალეტი / pallet', value: 'pallet'},
];

// Custom hook for debounced API calls on text fields
const useDebouncedField = (initialValue, onSave, delay = 600) => {
    const [localValue, setLocalValue] = useState(initialValue);
    const timerRef = useRef(null);
    const latestValueRef = useRef(localValue);

    useEffect(() => {
        if (initialValue !== latestValueRef.current) {
            setLocalValue(initialValue);
            latestValueRef.current = initialValue;
        }
    }, [initialValue]);

    const handleChange = useCallback((value) => {
        setLocalValue(value);
        latestValueRef.current = value;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            onSave(value);
        }, delay);
    }, [onSave, delay]);

    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    const flush = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
            onSave(latestValueRef.current);
        }
    }, [onSave]);

    return [localValue, handleChange, flush];
};

const CartTableRow = memo(({
    item,
    stockNumber,
    assigned,
    orderId,
    onLocalOrderUpdate,
    notify,
    t,
    canApplyDiscount,
    maxDiscountPercent,
    giftEnabled,
}) => {
    const [editingPrice, setEditingPrice] = useState(false);
    const [editingDiscount, setEditingDiscount] = useState(false);

    const handleQuantityChange = useCallback(async (newQuantity) => {
        if (newQuantity < 1) return;
        const result = await orderService.updateOrderItem(orderId, item.id, {quantity: newQuantity});
        if (result.success) onLocalOrderUpdate(result.data);
        else notify.error(t.orderError, result.error);
    }, [orderId, item.id, onLocalOrderUpdate, notify, t]);

    const handlePriceSave = useCallback(async (val) => {
        const result = await orderService.updateOrderItem(orderId, item.id, {
            discounted_price: val == null ? null : val,
            discount_percent: 0,
        });
        if (result.success) onLocalOrderUpdate(result.data);
        else notify.error(t.orderError, result.error);
    }, [orderId, item.id, onLocalOrderUpdate, notify, t]);

    const handleDiscountSave = useCallback(async (val) => {
        const result = await orderService.updateOrderItem(orderId, item.id, {
            discount_percent: val == null ? 0 : val,
            discounted_price: null,
        });
        if (result.success) onLocalOrderUpdate(result.data);
        else notify.error(t.orderError, result.error);
    }, [orderId, item.id, onLocalOrderUpdate, notify, t]);

    const handleRemoveLine = useCallback(async () => {
        const result = await orderService.removeOrderItem(orderId, item.id);
        if (result.success) onLocalOrderUpdate(result.data);
        else notify.error(t.orderError, result.error);
    }, [orderId, item.id, onLocalOrderUpdate, notify, t]);

    const handleGiftToggle = useCallback(async () => {
        const result = await orderService.updateOrderItem(orderId, item.id, {
            is_gift: !item.is_gift,
        });
        if (result.success) onLocalOrderUpdate(result.data);
        else notify.error(t.orderError, result.error);
    }, [orderId, item.id, item.is_gift, onLocalOrderUpdate, notify, t]);

    const exceedsLocal =
        Number.isFinite(stockNumber) && Number(item.quantity) > Number(stockNumber);
    const hasDiscount =
        item.effective_price && parseFloat(item.effective_price) !== parseFloat(item.price);
    const discountPct = parseFloat(item.discount_percent || 0);
    const priceCap = parseFloat(item.price || 0);
    const isPending = item._pending === true || String(item.id).startsWith('tmp_');

    return (
        <div className="m-cart-row" style={{opacity: isPending ? 0.6 : 1}}>
            <div className="m-cart-cell m-cart-cell-warehouse" data-label={t.warehouse}>
                <Tag color={assigned ? 'green' : 'blue'} style={{fontSize: 11, margin: 0}}>
                    {item.warehouse_name}
                    {assigned && <span style={{marginLeft: 4}}>✓</span>}
                </Tag>
                {item.is_gift && (
                    <Tag color="magenta" style={{fontSize: 10, marginLeft: 4}}>
                        {t.giftLabel}
                    </Tag>
                )}
                {isPending && (
                    <CloudSyncOutlined style={{marginLeft: 6, color: '#faad14'}} title={t.offlineItemPending}/>
                )}
                {Number.isFinite(stockNumber) && (
                    <Text type={exceedsLocal ? 'warning' : 'secondary'} style={{fontSize: 11, marginLeft: 6}}>
                        {exceedsLocal && <WarningOutlined style={{marginRight: 2}}/>}
                        {t.stockRemaining}: {stockNumber}
                    </Text>
                )}
            </div>

            <div className="m-cart-cell m-cart-cell-qty" data-label={t.quantity}>
                <div className="m-qty-stepper">
                    <Button size="small" icon={<MinusOutlined/>}
                            onClick={() => handleQuantityChange(item.quantity - 1)}
                            disabled={item.quantity <= 1}
                            className="m-qty-btn"/>
                    <InputNumber min={1} value={item.quantity} size="small"
                                 onChange={handleQuantityChange}
                                 className="m-qty-input"
                                 controls={false} inputMode="numeric" pattern="[0-9]*"/>
                    <Button size="small" icon={<PlusOutlined/>}
                            onClick={() => handleQuantityChange(item.quantity + 1)}
                            className="m-qty-btn"/>
                </div>
            </div>

            <div className="m-cart-cell m-cart-cell-price" data-label={t.price}>
                {editingPrice ? (
                    <InputNumber
                        autoFocus
                        size="small"
                        min={0}
                        max={priceCap > 0 ? priceCap : undefined}
                        defaultValue={parseFloat(item.effective_price ?? item.price)}
                        addonAfter="₾"
                        controls={false}
                        inputMode="decimal"
                        style={{width: 110}}
                        onPressEnter={(e) => {
                            const v = parseFloat(e.target.value);
                            handlePriceSave(Number.isFinite(v) ? v : null);
                            setEditingPrice(false);
                        }}
                        onBlur={(e) => {
                            const v = parseFloat(e.target.value);
                            handlePriceSave(Number.isFinite(v) ? v : null);
                            setEditingPrice(false);
                        }}
                    />
                ) : (
                    <button
                        type="button"
                        className="m-cart-inline-edit"
                        onClick={() => setEditingPrice(true)}
                        title={t.overridePrice}
                    >
                        {hasDiscount ? (
                            <>
                                <Text delete type="secondary" style={{fontSize: 11, marginRight: 4}}>
                                    {item.price} ₾
                                </Text>
                                <Text style={{fontSize: 13, fontWeight: 500}}>
                                    {item.effective_price} ₾
                                </Text>
                            </>
                        ) : (
                            <Text style={{fontSize: 13, fontWeight: 500}}>{item.price} ₾</Text>
                        )}
                    </button>
                )}
            </div>

            <div className="m-cart-cell m-cart-cell-discount" data-label={t.discountPercent}>
                {canApplyDiscount && editingDiscount ? (
                    <InputNumber
                        autoFocus
                        size="small"
                        min={0}
                        max={Math.min(100, maxDiscountPercent || 100)}
                        defaultValue={discountPct || 0}
                        addonAfter="%"
                        controls={false}
                        inputMode="decimal"
                        style={{width: 90}}
                        onPressEnter={(e) => {
                            const v = parseFloat(e.target.value);
                            handleDiscountSave(Number.isFinite(v) ? v : 0);
                            setEditingDiscount(false);
                        }}
                        onBlur={(e) => {
                            const v = parseFloat(e.target.value);
                            handleDiscountSave(Number.isFinite(v) ? v : 0);
                            setEditingDiscount(false);
                        }}
                    />
                ) : (
                    <button
                        type="button"
                        className="m-cart-inline-edit"
                        onClick={() => canApplyDiscount && setEditingDiscount(true)}
                        disabled={!canApplyDiscount}
                        title={canApplyDiscount ? t.discountPercent : undefined}
                    >
                        {discountPct > 0 ? (
                            <Text style={{fontSize: 13}}>{discountPct}%</Text>
                        ) : (
                            <Text type="secondary" style={{fontSize: 13}}>—</Text>
                        )}
                    </button>
                )}
            </div>

            <div className="m-cart-cell m-cart-cell-total" data-label={t.total}>
                <Text strong style={{fontSize: 14, color: '#52c41a'}}>
                    {item.line_total} ₾
                </Text>
            </div>

            <div className="m-cart-cell m-cart-cell-action">
                <GiftToggleButton
                    enabled={giftEnabled}
                    isGift={!!item.is_gift}
                    onToggle={handleGiftToggle}
                    label={t.giftLabel}
                />
                <Popconfirm
                    title={t.removeFromAllWarehouses || t.confirmDelete || 'Remove?'}
                    onConfirm={handleRemoveLine}
                    okText={t.yes}
                    cancelText={t.no}
                >
                    <Button type="text" danger size="small" icon={<DeleteOutlined/>}
                            aria-label={t.delete}/>
                </Popconfirm>
            </div>
        </div>
    );
});

CartTableRow.displayName = 'CartTableRow';

const OrderItemGroupCard = memo(({
    group,
    orderId,
    onLocalOrderUpdate,
    notify,
    t,
    // eslint-disable-next-line no-unused-vars
    unitOptions,
    discountConfig,
    assignedCodes,
}) => {
    const [showOtherWarehouses, setShowOtherWarehouses] = useState(false);
    const {canApplyDiscount, maxDiscountPercent, giftEnabled} = discountConfig;

    // Lazy-loaded stock for this SKU. null = not yet fetched, array = fetched data,
    // 'error' = fetch failed. ensureStock returns a Promise so callers can await
    // the in-flight fetch instead of racing against it.
    const [stock, setStock] = useState(null);
    const stockPromiseRef = useRef(null);
    const ensureStock = useCallback(() => {
        if (stock != null) return Promise.resolve(stock);
        if (stockPromiseRef.current) return stockPromiseRef.current;
        // Upstream's GetStockAndPrices keys off the user-typed article (or
        // a barcode); the canonical `sku` returned in scan responses isn't
        // always a valid lookup key. Prefer `article`, fall back to `sku`.
        const lookupKey = group.article || group.sku;
        const promise = productService.searchProduct({
            sku: lookupKey,
            searchType: 'article',
            warehouseCodes: [],
            includeImages: false,
        }).then((result) => {
            stockPromiseRef.current = null;
            if (result.success && Array.isArray(result.data?.stock)) {
                // Mirror the scan view: hide warehouses with negative balance
                // — they're upstream accounting artefacts, not sellable stock.
                const visibleStock = result.data.stock.filter(
                    (s) => (Number(s.quantity) || 0) >= 0
                );
                setStock(visibleStock);
                return visibleStock;
            }
            // eslint-disable-next-line no-console
            console.warn('[cart] stock fetch failed for', lookupKey, result);
            setStock('error');
            return 'error';
        });
        stockPromiseRef.current = promise;
        return promise;
    }, [group.article, group.sku, stock]);

    const stockByCode = useMemo(() => {
        if (!Array.isArray(stock)) return new Map();
        return new Map(stock.map((s) => [s.warehouse, Number(s.quantity || 0)]));
    }, [stock]);

    const totalStock = useMemo(() => {
        if (!Array.isArray(stock)) return null;
        return stock.reduce((acc, s) => acc + Number(s.quantity || 0), 0);
    }, [stock]);

    const itemIds = useMemo(
        () => group.items.map((i) => i.id),
        [group.items],
    );

    const handleRemoveGroup = useCallback(async () => {
        const results = await Promise.all(
            itemIds.map((id) => orderService.removeOrderItem(orderId, id))
        );
        const failed = results.find((r) => !r.success);
        if (failed) {
            notify.error(t.orderError, failed.error);
            return;
        }
        const lastOrder = results[results.length - 1].data;
        if (lastOrder) onLocalOrderUpdate(lastOrder);
    }, [itemIds, orderId, onLocalOrderUpdate, notify, t]);

    // Eager-fetch stock once per card mount so the per-row stock captions
    // (and the "other warehouses" toggle) are ready when the card renders.
    useEffect(() => {
        ensureStock();
    }, [ensureStock]);

    const cardExceeds = totalStock != null && group.totalQty > totalStock;

    const lineRows = useMemo(
        () => group.items.map((it) => ({
            key: `line-${it.id}`,
            item: it,
            assigned: assignedCodes.has(it.warehouse_code),
        })),
        [group.items, assignedCodes],
    );

    const otherWarehouses = useMemo(() => {
        if (!Array.isArray(stock)) return [];
        const presentCodes = new Set(group.items.map((it) => it.warehouse_code));
        return stock
            .filter((s) => !presentCodes.has(s.warehouse) && Number(s.quantity || 0) > 0)
            .map((s) => ({
                key: `stock-${s.warehouse}`,
                stockEntry: s,
                stock: Number(s.quantity || 0),
                assigned: assignedCodes.has(s.warehouse),
            }));
    }, [stock, group.items, assignedCodes]);

    return (
        <div className="m-order-item-card m-cart-card">
            <div className="m-cart-card-header">
                <div className="m-cart-card-thumb" aria-hidden="true">
                    <ShopOutlined/>
                </div>
                <div className="m-cart-card-title">
                    <Text strong style={{fontSize: 14, display: 'block'}} ellipsis>
                        {group.sku_name || group.sku}
                    </Text>
                    <Text type="secondary" style={{fontSize: 12}}>
                        {t.article}: {group.article || group.sku}
                    </Text>
                </div>
                <Popconfirm
                    title={t.removeFromAllWarehouses || t.confirmDelete || 'Remove product?'}
                    onConfirm={handleRemoveGroup}
                    okText={t.yes}
                    cancelText={t.no}
                >
                    <Button type="text" danger size="small" icon={<DeleteOutlined/>}
                            className="m-item-delete-btn" aria-label={t.delete}/>
                </Popconfirm>
            </div>

            <div className="m-cart-table">
                <div className="m-cart-row m-cart-row-header" aria-hidden="true">
                    <div className="m-cart-cell">{t.warehouse}</div>
                    <div className="m-cart-cell">{t.quantity}</div>
                    <div className="m-cart-cell">{t.price}</div>
                    <div className="m-cart-cell">{t.discountPercent}</div>
                    <div className="m-cart-cell">{t.total}</div>
                    <div className="m-cart-cell"></div>
                </div>

                {lineRows.map((row) => (
                    <CartTableRow
                        key={row.key}
                        item={row.item}
                        stockNumber={Array.isArray(stock) ? stockByCode.get(row.item.warehouse_code) : null}
                        assigned={row.assigned}
                        orderId={orderId}
                        onLocalOrderUpdate={onLocalOrderUpdate}
                        notify={notify}
                        t={t}
                        canApplyDiscount={canApplyDiscount}
                        maxDiscountPercent={maxDiscountPercent}
                        giftEnabled={giftEnabled}
                    />
                ))}
            </div>

            {cardExceeds && (
                <Flex align="center" gap={4} className="m-cart-card-warning">
                    <WarningOutlined style={{color: '#faad14', fontSize: 12}}/>
                    <Text type="warning" style={{fontSize: 11}}>
                        {t.exceedsStock(totalStock)}
                    </Text>
                </Flex>
            )}

            <div className="m-cart-card-footer">
                <Text type="secondary" style={{fontSize: 12}}>{t.total}:</Text>
                <Text strong style={{color: '#52c41a', fontSize: 16, marginLeft: 8}}>
                    {group.groupLineTotal} ₾
                </Text>
            </div>

            {otherWarehouses.length > 0 && (
                <div className="m-cart-card-others">
                    <Button
                        type="link"
                        size="small"
                        onClick={() => setShowOtherWarehouses((v) => !v)}
                        style={{padding: 0}}
                    >
                        {showOtherWarehouses
                            ? t.hideOtherWarehouses
                            : t.showOtherWarehouses(otherWarehouses.length)}
                    </Button>
                    {showOtherWarehouses && otherWarehouses.map((row) => (
                        <Flex key={row.key} align="center" gap={8} style={{marginTop: 4, opacity: 0.6}}>
                            <Tag color={row.assigned ? 'green' : 'blue'} style={{fontSize: 10}}>
                                {row.stockEntry.warehouse_name}
                                {row.assigned && <span style={{marginLeft: 4}}>✓</span>}
                            </Tag>
                            <Text type="secondary" style={{fontSize: 11}}>
                                {t.stockRemaining}: {row.stock}
                            </Text>
                        </Flex>
                    ))}
                </div>
            )}
        </div>
    );
});

OrderItemGroupCard.displayName = 'OrderItemGroupCard';

// Memoized delivery section component with local state for text inputs
const DeliverySection = memo(({order, onLocalOrderUpdate, notify, t, deliveryExpanded, setDeliveryExpanded}) => {
    const handleDeliveryTypeChange = useCallback(async (e) => {
        const deliveryType = e.target.value;
        const result = await orderService.updateOrder(order.id, {delivery_type: deliveryType});
        if (result.success) {
            onLocalOrderUpdate(result.data);
            setDeliveryExpanded(deliveryType === 'delivery' ? ['delivery'] : []);
        } else {
            notify.error(t.orderError, result.error);
        }
    }, [order.id, onLocalOrderUpdate, notify, t, setDeliveryExpanded]);

    const saveDeliveryAddress = useCallback(async (value) => {
        const result = await orderService.updateOrder(order.id, {delivery_address: value || ''});
        if (result.success) {
            onLocalOrderUpdate(result.data);
        } else {
            notify.error(t.orderError, result.error);
        }
    }, [order.id, onLocalOrderUpdate, notify, t]);

    const saveDeliveryNotes = useCallback(async (value) => {
        const result = await orderService.updateOrder(order.id, {delivery_notes: value || ''});
        if (result.success) {
            onLocalOrderUpdate(result.data);
        } else {
            notify.error(t.orderError, result.error);
        }
    }, [order.id, onLocalOrderUpdate, notify, t]);

    const handleDeliveryDateChange = useCallback(async (date, dateString) => {
        // DRF DateField rejects empty strings; send null when the user clears.
        const result = await orderService.updateOrder(order.id, {delivery_date: dateString || null});
        if (result.success) {
            onLocalOrderUpdate(result.data);
        } else {
            notify.error(t.orderError, result.error);
        }
    }, [order.id, onLocalOrderUpdate, notify, t]);

    const handleDeliveryTimeFromChange = useCallback(async (time, timeString) => {
        const result = await orderService.updateOrder(order.id, {delivery_time_from: timeString || null});
        if (result.success) {
            onLocalOrderUpdate(result.data);
        } else {
            notify.error(t.orderError, result.error);
        }
    }, [order.id, onLocalOrderUpdate, notify, t]);

    const handleDeliveryTimeToChange = useCallback(async (time, timeString) => {
        const result = await orderService.updateOrder(order.id, {delivery_time_to: timeString || null});
        if (result.success) {
            onLocalOrderUpdate(result.data);
        } else {
            notify.error(t.orderError, result.error);
        }
    }, [order.id, onLocalOrderUpdate, notify, t]);

    const [addressValue, handleAddressChange, flushAddress] = useDebouncedField(
        order.delivery_address || '',
        saveDeliveryAddress
    );

    const [deliveryNotesValue, handleDeliveryNotesChange, flushDeliveryNotes] = useDebouncedField(
        order.delivery_notes || '',
        saveDeliveryNotes
    );

    // ===== Recipient (same / different) =====
    const saveRecipientField = useCallback(async (patch) => {
        const result = await orderService.updateOrder(order.id, patch);
        if (result.success) onLocalOrderUpdate(result.data);
        else notify.error(t.orderError, result.error);
    }, [order.id, onLocalOrderUpdate, notify, t]);

    const handleRecipientTypeChange = useCallback((value) => {
        const isDifferent = value === 'different';
        const patch = {recipient_is_different: isDifferent};
        if (!isDifferent) {
            // Switching back to "same" clears any stray recipient fields so the
            // saved state matches what the user sees.
            patch.recipient_first_name = '';
            patch.recipient_last_name = '';
            patch.recipient_phone = '';
        }
        saveRecipientField(patch);
    }, [saveRecipientField]);

    const [recipientFirst, setRecipientFirst, flushRecipientFirst] = useDebouncedField(
        order.recipient_first_name || '',
        (v) => saveRecipientField({recipient_first_name: v || ''}),
    );
    const [recipientLast, setRecipientLast, flushRecipientLast] = useDebouncedField(
        order.recipient_last_name || '',
        (v) => saveRecipientField({recipient_last_name: v || ''}),
    );
    const [recipientPhone, setRecipientPhone, flushRecipientPhone] = useDebouncedField(
        order.recipient_phone || '',
        (v) => saveRecipientField({recipient_phone: v || ''}),
    );

    const recipientIsDifferent = !!order.recipient_is_different;
    // +995 + 9 digits, or 9 digits, or empty
    const phoneValid = !recipientPhone || /^(\+995)?\d{9}$/.test(recipientPhone.replace(/\s+/g, ''));

    return (
        <div style={{marginBottom: 12}}>
            <Flex align="center" gap={8} style={{marginBottom: 8}}>
                <UserOutlined style={{color: '#1677ff'}}/>
                <Text strong>{t.recipient}</Text>
            </Flex>
            <Segmented
                block
                size="middle"
                value={recipientIsDifferent ? 'different' : 'same'}
                onChange={handleRecipientTypeChange}
                options={[
                    {label: t.recipientSame, value: 'same'},
                    {label: t.recipientDifferent, value: 'different'},
                ]}
                style={{marginBottom: 8}}
            />
            {recipientIsDifferent ? (
                <Space direction="vertical" style={{width: '100%', marginBottom: 12}} size={8}>
                    <Flex gap={8}>
                        <Input
                            placeholder={t.firstName}
                            value={recipientFirst}
                            onChange={(e) => setRecipientFirst(e.target.value)}
                            onBlur={flushRecipientFirst}
                            size="large"
                            style={{flex: 1}}
                        />
                        <Input
                            placeholder={t.lastName}
                            value={recipientLast}
                            onChange={(e) => setRecipientLast(e.target.value)}
                            onBlur={flushRecipientLast}
                            size="large"
                            style={{flex: 1}}
                        />
                    </Flex>
                    <Input
                        placeholder={t.phone}
                        value={recipientPhone}
                        onChange={(e) => setRecipientPhone(e.target.value)}
                        onBlur={flushRecipientPhone}
                        size="large"
                        status={!phoneValid ? 'error' : ''}
                    />
                    {!phoneValid && (
                        <Text type="danger" style={{fontSize: 12}}>{t.phoneInvalid}</Text>
                    )}
                </Space>
            ) : (
                <div style={{
                    padding: '8px 12px',
                    background: 'rgba(0,0,0,0.03)',
                    borderRadius: 8,
                    marginBottom: 12,
                }}>
                    <Text style={{fontSize: 13, display: 'block'}}>
                        {displayCustomerName(order, t) || '—'}
                    </Text>
                    {order.customer_phone && (
                        <Text type="secondary" style={{fontSize: 12}}>
                            {order.customer_phone}
                        </Text>
                    )}
                </div>
            )}

            <Flex align="center" gap={8} style={{marginBottom: 8}}>
                <CarOutlined style={{color: '#1677ff'}}/>
                <Text strong>{t.deliveryType}</Text>
            </Flex>
            <Radio.Group
                value={order.delivery_type || 'pickup'}
                onChange={handleDeliveryTypeChange}
                buttonStyle="solid"
                size="middle"
                style={{marginBottom: 8, width: '100%'}}
                className="m-delivery-radio"
            >
                <Radio.Button value="pickup" style={{width: '50%', textAlign: 'center'}}>
                    <ShopOutlined/> {t.pickup}
                </Radio.Button>
                <Radio.Button value="delivery" style={{width: '50%', textAlign: 'center'}}>
                    <CarOutlined/> {t.delivery}
                </Radio.Button>
            </Radio.Group>

            {order.delivery_type === 'delivery' && (
                <Collapse
                    ghost
                    activeKey={deliveryExpanded}
                    onChange={setDeliveryExpanded}
                    items={[{
                        key: 'delivery',
                        label: (
                            <Flex align="center" gap={6}>
                                <EnvironmentOutlined style={{color: '#faad14'}}/>
                                <Text type="secondary" style={{fontSize: 12}}>{t.deliveryInfo}</Text>
                            </Flex>
                        ),
                        children: (
                            <Space direction="vertical" style={{width: '100%'}} size={8}>
                                <Input
                                    placeholder={t.deliveryAddress}
                                    value={addressValue}
                                    onChange={(e) => handleAddressChange(e.target.value)}
                                    onBlur={flushAddress}
                                    prefix={<EnvironmentOutlined style={{opacity: 0.4}}/>}
                                    size="large"
                                />
                                <DatePicker
                                    placeholder={t.deliveryDate}
                                    size="large"
                                    style={{width: '100%'}}
                                    onChange={handleDeliveryDateChange}
                                    disabledDate={(current) => current && current < dayjs().startOf('day')}
                                />
                                <Flex gap={8}>
                                    <TimePicker
                                        placeholder={t.deliveryTimeFrom}
                                        format="HH:mm"
                                        size="large"
                                        style={{flex: 1}}
                                        onChange={handleDeliveryTimeFromChange}
                                        needConfirm={false}
                                    />
                                    <TimePicker
                                        placeholder={t.deliveryTimeTo}
                                        format="HH:mm"
                                        size="large"
                                        style={{flex: 1}}
                                        onChange={handleDeliveryTimeToChange}
                                        needConfirm={false}
                                    />
                                </Flex>
                                <TextArea
                                    placeholder={t.deliveryNotes}
                                    value={deliveryNotesValue}
                                    onChange={(e) => handleDeliveryNotesChange(e.target.value)}
                                    onBlur={flushDeliveryNotes}
                                    rows={2}
                                    size="large"
                                />
                            </Space>
                        ),
                    }]}
                />
            )}
        </div>
    );
});

DeliverySection.displayName = 'DeliverySection';

// Memoized notes section with local state
const NotesSection = memo(({order, onLocalOrderUpdate, notify, t}) => {
    const saveNotes = useCallback(async (value) => {
        const result = await orderService.updateOrder(order.id, {notes: value || ''});
        if (result.success) {
            onLocalOrderUpdate(result.data);
        } else {
            notify.error(t.orderError, result.error);
        }
    }, [order.id, onLocalOrderUpdate, notify, t]);

    const [notesValue, handleNotesChange, flushNotes] = useDebouncedField(
        order.notes || '',
        saveNotes
    );

    return (
        <Collapse
            ghost
            size="small"
            items={[{
                key: 'notes',
                label: (
                    <Flex align="center" gap={6}>
                        <CommentOutlined style={{color: '#1677ff'}}/>
                        <Text type="secondary" style={{fontSize: 12}}>
                            {t.orderNotes}
                            {order.notes && <Tag style={{marginLeft: 6, fontSize: 10}} color="blue">✓</Tag>}
                        </Text>
                    </Flex>
                ),
                children: (
                    <TextArea
                        placeholder={t.orderNotes}
                        value={notesValue}
                        onChange={(e) => handleNotesChange(e.target.value)}
                        onBlur={flushNotes}
                        rows={3}
                        size="large"
                    />
                ),
            }]}
        />
    );
});

NotesSection.displayName = 'NotesSection';

const OrderPanel = ({order: initialOrder, onSaveForLater, onProceedToPayment, onDeleteOrder, onOrderUpdate, onChangeCustomer, notify, isMobileDrawer, confirmDisabled}) => {
    const {t} = useLanguage();
    const {authData} = useContext(AuthContext);
    const discountConfig = useMemo(() => ({
        canApplyDiscount: !!authData?.user?.can_apply_discount,
        maxDiscountPercent: parseFloat(authData?.user?.max_discount_percent || 0),
        giftEnabled: !!authData?.gift_marking_enabled,
    }), [authData?.user?.can_apply_discount, authData?.user?.max_discount_percent,
         authData?.gift_marking_enabled]);
    const assignedCodes = useMemo(
        () => new Set((authData?.user?.warehouses || []).map((w) => w.code)),
        [authData?.user?.warehouses],
    );
    // Keep order state LOCAL so updates don't re-render the parent (and the Drawer)
    const [localOrder, setLocalOrder] = useState(initialOrder);
    const [step, setStep] = useState(1);
    const [deliveryExpanded, setDeliveryExpanded] = useState(
        initialOrder?.delivery_type === 'delivery' ? ['delivery'] : []
    );

    // Keep a ref to the onOrderUpdate callback so we can notify parent silently
    const onOrderUpdateRef = useRef(onOrderUpdate);
    onOrderUpdateRef.current = onOrderUpdate;

    // Sync local order when the initial order prop changes from OUTSIDE
    // (e.g., when a product is added to the order from the scan tab)
    const lastOrderIdRef = useRef(initialOrder?.id);
    const lastItemCountRef = useRef(initialOrder?.items?.length || 0);
    // The panel never edits customer info itself, so any change in either
    // identifier is by definition an external update — sync immediately.
    const lastCustomerKeyRef = useRef(
        `${initialOrder?.external_client_id || ''}|${initialOrder?.customer_name || ''}`,
    );

    useEffect(() => {
        const newCustomerKey = `${initialOrder?.external_client_id || ''}|${initialOrder?.customer_name || ''}`;
        // Always sync if order ID changed (different order loaded)
        if (initialOrder?.id !== lastOrderIdRef.current) {
            setLocalOrder(initialOrder);
            lastOrderIdRef.current = initialOrder?.id;
            lastItemCountRef.current = initialOrder?.items?.length || 0;
            lastCustomerKeyRef.current = newCustomerKey;
            setStep(1);
            return;
        }
        // Sync if items were added from outside (item count increased externally)
        const newItemCount = initialOrder?.items?.length || 0;
        if (newItemCount !== lastItemCountRef.current) {
            setLocalOrder(initialOrder);
            lastItemCountRef.current = newItemCount;
        }
        // Sync if the customer was changed externally (e.g. via "Change
        // customer" in the actions menu — the parent PATCHes the order and
        // pushes the new data through props).
        if (newCustomerKey !== lastCustomerKeyRef.current) {
            setLocalOrder(initialOrder);
            lastCustomerKeyRef.current = newCustomerKey;
        }
    }, [initialOrder]);

    // Handle local order updates: update local state + silently notify parent via ref
    const handleLocalOrderUpdate = useCallback((updatedOrder) => {
        setLocalOrder(updatedOrder);
        lastItemCountRef.current = updatedOrder?.items?.length || 0;
        // Notify parent silently (via ref, so this callback never changes)
        if (onOrderUpdateRef.current) {
            onOrderUpdateRef.current(updatedOrder);
        }
    }, []);

    const unitOptions = t.unitOptions || UNIT_OPTIONS;

    const groups = useMemo(
        () => groupItemsBySku(localOrder?.items || []),
        [localOrder?.items],
    );

    if (!localOrder) return null;

    const hasItems = localOrder.items && localOrder.items.length > 0;

    const handleDeleteClick = () => {
        Modal.confirm({
            title: t.confirmDeleteOrder,
            okText: t.yes,
            cancelText: t.no,
            okButtonProps: {danger: true},
            onOk: onDeleteOrder,
        });
    };

    const orderActionsMenu = {
        items: [
            ...(onChangeCustomer
                ? [{
                    key: 'change-customer',
                    label: t.changeCustomer,
                    icon: <UserSwitchOutlined/>,
                    onClick: onChangeCustomer,
                }]
                : []),
            {
                key: 'delete',
                label: t.deleteOrder || t.delete || 'Delete',
                icon: <DeleteOutlined/>,
                danger: true,
                onClick: handleDeleteClick,
            },
        ],
    };

    const actionsTrigger = (
        <Flex gap={4} align="center">
            <Button
                icon={<SaveOutlined/>}
                onClick={onSaveForLater}
                size="middle"
            >
                {t.saveForLater}
            </Button>
            <Dropdown menu={orderActionsMenu} trigger={['click']} placement="bottomRight">
                <Button
                    icon={<MoreOutlined style={{fontSize: 20}}/>}
                    type="text"
                    aria-label={t.moreActions || 'More actions'}
                />
            </Dropdown>
        </Flex>
    );

    return (
        <div className={`m-order-panel ${isMobileDrawer ? 'm-order-panel-drawer' : ''}`}>
            {/* Drawer mode: surface Save + overflow menu at the top of the panel
                (the Drawer's own header has no slot for action buttons). */}
            {isMobileDrawer && (
                <Flex justify="flex-end" style={{marginBottom: 8, marginTop: -4}}>
                    {actionsTrigger}
                </Flex>
            )}

            {/* Header (only show when not in drawer - drawer has its own header) */}
            {!isMobileDrawer && (
                <Card
                    size="small"
                    className="m-order-header-card"
                    styles={{header: {overflow: 'visible'}}}
                    title={
                        <Flex align="center" gap={12} style={{paddingTop: 4, paddingBottom: 4}}>
                            <Badge count={localOrder.items?.length || 0} size="small" overflowCount={99}>
                                <ShoppingCartOutlined style={{fontSize: 18, color: '#1677ff'}}/>
                            </Badge>
                            <span style={{fontWeight: 600}}>{t.activeOrder} #{localOrder.id}</span>
                            <Tag color="blue">{t.orderDraft}</Tag>
                        </Flex>
                    }
                    extra={actionsTrigger}
                >
                    {/* Customer info */}
                    <Flex align="center" gap={8} className="m-customer-bar">
                        <UserOutlined style={{color: '#1677ff'}}/>
                        <Text strong>{displayCustomerName(localOrder, t)}</Text>
                    </Flex>
                </Card>
            )}

            {/* Customer info (in drawer mode) */}
            {isMobileDrawer && (
                <Flex align="center" gap={8} className="m-customer-bar">
                    <UserOutlined style={{color: '#1677ff'}}/>
                    <Text strong>{displayCustomerName(localOrder, t)}</Text>
                </Flex>
            )}

            {/* Step indicator */}
            <Steps
                current={step - 1}
                size="small"
                onChange={(idx) => {
                    const target = idx + 1;
                    if (target === 2 && !hasItems) return;
                    setStep(target);
                }}
                items={[
                    {title: t.stepProducts},
                    {title: t.stepDelivery, disabled: !hasItems},
                ]}
                style={{margin: '8px 0 12px'}}
            />

            {/* Step 1 — Products */}
            {step === 1 && (
                hasItems ? (
                    <>
                        <div className="m-order-items-list">
                            {groups.map((group) => (
                                <OrderItemGroupCard
                                    key={group.sku}
                                    group={group}
                                    orderId={localOrder.id}
                                    onLocalOrderUpdate={handleLocalOrderUpdate}
                                    notify={notify}
                                    t={t}
                                    unitOptions={unitOptions}
                                    discountConfig={discountConfig}
                                    assignedCodes={assignedCodes}
                                />
                            ))}
                        </div>

                        {/* Order Total */}
                        <div className="m-order-total-bar">
                            <Text style={{fontSize: 15}}>{t.orderTotal}:</Text>
                            <Title level={4} style={{margin: 0, color: '#52c41a'}}>
                                {localOrder.total} ₾
                            </Title>
                        </div>
                    </>
                ) : (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={
                            <span style={{opacity: 0.6}}>{t.scanToAddProduct}</span>
                        }
                        style={{margin: '24px 0'}}
                    />
                )
            )}

            {/* Step 2 — Delivery + Notes */}
            {step === 2 && (
                <>
                    <DeliverySection
                        order={localOrder}
                        onLocalOrderUpdate={handleLocalOrderUpdate}
                        notify={notify}
                        t={t}
                        deliveryExpanded={deliveryExpanded}
                        setDeliveryExpanded={setDeliveryExpanded}
                    />

                    {/* Order Notes */}
                    <NotesSection
                        order={localOrder}
                        onLocalOrderUpdate={handleLocalOrderUpdate}
                        notify={notify}
                        t={t}
                    />
                </>
            )}

            {/* Action bar — step-aware */}
            <div className="m-order-actions">
                {step === 1 ? (
                    <Button
                        type="primary"
                        disabled={!hasItems}
                        onClick={() => setStep(2)}
                        className="m-order-action-btn"
                        size="large"
                        block
                    >
                        {t.nextStep} →
                    </Button>
                ) : (
                    <Flex gap={8}>
                        <Button
                            onClick={() => setStep(1)}
                            size="large"
                            style={{flex: 1}}
                        >
                            ← {t.backStep}
                        </Button>
                        <Popconfirm
                            title={t.confirmProceedToPayment}
                            onConfirm={onProceedToPayment}
                            okText={t.yes}
                            cancelText={t.no}
                            disabled={!hasItems || confirmDisabled}
                        >
                            <Button
                                type="primary"
                                icon={<DollarOutlined/>}
                                disabled={!hasItems || confirmDisabled}
                                size="large"
                                style={{flex: 2}}
                            >
                                {t.proceedToPayment}
                            </Button>
                        </Popconfirm>
                    </Flex>
                )}
            </div>
        </div>
    );
};

OrderPanel.displayName = 'OrderPanel';

export default OrderPanel;

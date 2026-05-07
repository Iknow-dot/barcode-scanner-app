import React, {useState, useCallback, useEffect, useMemo, useRef, useContext, memo} from 'react';
import dayjs from 'dayjs';
import {useLanguage} from '../../i18n/LanguageContext';
import {orderService, productService} from '../../api';
import AuthContext from '../Auth/AuthContext';
import groupItemsBySku from './groupItemsBySku';
import distributeStock from './distributeStock';
import inheritFromGroup from './inheritFromGroup';
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
    Select,
    Dropdown,
    Modal,
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
    UndoOutlined,
    WarningOutlined,
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

const WarehouseSubRow = memo(({item, stockText, stockNumber, assigned, orderId, onLocalOrderUpdate, notify, t}) => {
    const [overrideOpen, setOverrideOpen] = useState(false);

    const handleQuantityChange = useCallback(async (newQuantity) => {
        if (newQuantity < 1) return;
        const result = await orderService.updateOrderItem(orderId, item.id, {quantity: newQuantity});
        if (result.success) onLocalOrderUpdate(result.data);
        else notify.error(t.orderError, result.error);
    }, [orderId, item.id, onLocalOrderUpdate, notify, t]);

    const handleOverrideSave = useCallback(async (val) => {
        const result = await orderService.updateOrderItem(orderId, item.id, {
            discounted_price: val == null ? null : val,
            discount_percent: 0,
        });
        if (result.success) onLocalOrderUpdate(result.data);
        else notify.error(t.orderError, result.error);
    }, [orderId, item.id, onLocalOrderUpdate, notify, t]);

    const handleResetPrice = useCallback(async () => {
        const result = await orderService.updateOrderItem(orderId, item.id, {
            discounted_price: null,
            discount_percent: 0,
        });
        if (result.success) onLocalOrderUpdate(result.data);
        else notify.error(t.orderError, result.error);
    }, [orderId, item.id, onLocalOrderUpdate, notify, t]);

    const hasOverride = item.discounted_price != null || parseFloat(item.discount_percent || 0) > 0;
    const exceedsLocal =
        Number.isFinite(stockNumber) && Number(item.quantity) > Number(stockNumber);
    const hasDiscount =
        item.effective_price && parseFloat(item.effective_price) !== parseFloat(item.price);

    return (
        <Flex vertical gap={6} className="m-warehouse-subrow">
            {/* Line 1 — warehouse name */}
            <Tag color={assigned ? 'green' : 'blue'} style={{fontSize: 11, alignSelf: 'flex-start'}}>
                {item.warehouse_name}
                {assigned && <span style={{marginLeft: 4}}>✓</span>}
            </Tag>

            {/* Line 2 — stock (with warning if needed) */}
            <Flex align="center" gap={6} wrap="wrap">
                {stockText != null && (
                    <Text type="secondary" style={{fontSize: 12}}>
                        {t.stockRemaining}: {stockText}
                    </Text>
                )}
                {exceedsLocal && (
                    <Flex align="center" gap={2}>
                        <WarningOutlined style={{color: '#faad14', fontSize: 12}}/>
                        <Text type="warning" style={{fontSize: 12}}>
                            {t.exceedsStock(stockNumber)}
                        </Text>
                    </Flex>
                )}
            </Flex>

            {/* Line 3 — qty stepper */}
            <div className="m-qty-stepper" style={{alignSelf: 'flex-start'}}>
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

            {/* Line 4 — unit price + line total */}
            <Flex align="center" gap={6} wrap="wrap">
                {hasDiscount ? (
                    <>
                        <Text delete type="secondary" style={{fontSize: 12}}>{item.price} ₾</Text>
                        <Text style={{fontSize: 13, fontWeight: 500}}>{item.effective_price} ₾</Text>
                    </>
                ) : (
                    <Text style={{fontSize: 13, fontWeight: 500}}>{item.price} ₾</Text>
                )}
                <Text type="secondary" style={{fontSize: 12}}>· {t.total || 'Total'}:</Text>
                <Text strong style={{fontSize: 14, color: '#52c41a'}}>
                    {item.line_total} ₾
                </Text>
            </Flex>

            {/* Line 5 — override price */}
            <Flex align="center" gap={6} wrap="wrap">
                <Button type="link" size="small" onClick={() => setOverrideOpen((v) => !v)}
                        style={{padding: 0}}>
                    {overrideOpen ? (t.cancel || 'Cancel') : (t.overridePrice || 'Override price')}
                </Button>
                {overrideOpen && (
                    <InputNumber
                        min={0}
                        max={parseFloat(item.price || 0)}
                        defaultValue={parseFloat(item.discounted_price ?? item.price)}
                        size="small"
                        addonAfter="₾"
                        controls={false}
                        inputMode="decimal"
                        onBlur={(e) => {
                            const v = parseFloat(e.target.value);
                            handleOverrideSave(Number.isFinite(v) ? v : null);
                            setOverrideOpen(false);
                        }}
                    />
                )}
                {hasOverride && (
                    <Button type="text" size="small" icon={<UndoOutlined/>} onClick={handleResetPrice}
                            title={t.resetPrice} aria-label={t.resetPrice}/>
                )}
            </Flex>
        </Flex>
    );
});

WarehouseSubRow.displayName = 'WarehouseSubRow';

const SharedDiscountControl = memo(({group, maxDiscountPercent, applyBulk, onResetGroup, t}) => {
    const [mode, setMode] = useState(
        group.sharedDiscountedPrice != null ? 'price' : 'percent'
    );
    const sharedPercent = parseFloat(group.sharedDiscountPercent || 0);
    const sharedPrice = group.sharedDiscountedPrice
        ? parseFloat(group.sharedDiscountedPrice)
        : null;

    const onPercentChange = (val) => {
        applyBulk(
            {discount_percent: val || 0, discounted_price: null},
            group.isMixedDiscount,
            (it) => `${it.discount_percent}%`,
            `${val || 0}%`,
        );
    };
    const onPriceChange = (val) => {
        applyBulk(
            {discounted_price: val ?? null, discount_percent: 0},
            group.isMixedDiscount,
            (it) => (it.discounted_price ? `${it.discounted_price} ₾` : `${it.discount_percent}%`),
            val == null ? '—' : `${val} ₾`,
        );
    };

    const hasGroupOverride =
        group.isMixedDiscount ||
        (group.sharedDiscountedPrice != null) ||
        (parseFloat(group.sharedDiscountPercent || 0) > 0);

    return (
        <Flex align="center" gap={4}>
            <Select
                value={mode}
                onChange={(m) => {
                    setMode(m);
                    if (m === 'percent') onPriceChange(null);
                    else onPercentChange(0);
                }}
                options={[{label: '%', value: 'percent'}, {label: '₾', value: 'price'}]}
                size="small"
                className="m-discount-mode"
            />
            {mode === 'percent' ? (
                <InputNumber
                    min={0}
                    max={Math.min(100, maxDiscountPercent)}
                    value={group.isMixedDiscount ? undefined : sharedPercent}
                    placeholder={group.isMixedDiscount ? (t.mixed || 'Mixed') : undefined}
                    size="small"
                    onChange={onPercentChange}
                    className="m-discount-input"
                    controls={false} inputMode="decimal" addonAfter="%"
                />
            ) : (
                <InputNumber
                    min={0}
                    value={group.isMixedDiscount ? undefined : sharedPrice}
                    placeholder={group.isMixedDiscount ? (t.mixed || 'Mixed') : t.setPrice}
                    size="small"
                    onChange={onPriceChange}
                    className="m-discount-input"
                    controls={false} inputMode="decimal" addonAfter="₾"
                />
            )}
            {hasGroupOverride && (
                <Button type="text" size="small" icon={<UndoOutlined/>}
                        onClick={onResetGroup}
                        title={t.resetPrice} aria-label={t.resetPrice}/>
            )}
        </Flex>
    );
});

SharedDiscountControl.displayName = 'SharedDiscountControl';

const OrderItemGroupCard = memo(({
    group,
    orderId,
    onLocalOrderUpdate,
    notify,
    t,
    unitOptions,
    discountConfig,
    assignedCodes,
}) => {
    const [showOtherWarehouses, setShowOtherWarehouses] = useState(false);
    const {canApplyDiscount, maxDiscountPercent} = discountConfig;

    // Lazy-loaded stock for this SKU. null = not yet fetched, array = fetched data,
    // 'error' = fetch failed. ensureStock returns a Promise so callers can await
    // the in-flight fetch instead of racing against it.
    const [stock, setStock] = useState(null);
    const [stockLoading, setStockLoading] = useState(false);
    const stockPromiseRef = useRef(null);
    const ensureStock = useCallback(() => {
        if (stock != null) return Promise.resolve(stock);
        if (stockPromiseRef.current) return stockPromiseRef.current;
        setStockLoading(true);
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
            setStockLoading(false);
            stockPromiseRef.current = null;
            if (result.success && Array.isArray(result.data?.stock)) {
                setStock(result.data.stock);
                return result.data.stock;
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

    const applyBulk = useCallback(async (data, mixedFlag, formatCurrent, formatNew) => {
        const doApply = async () => {
            const result = await orderService.bulkUpdateOrderItems(orderId, itemIds, data);
            if (result.success) onLocalOrderUpdate(result.data);
            else notify.error(t.orderError, result.error);
        };

        if (mixedFlag) {
            const lines = group.items.map((it) => ({
                key: it.id,
                text: `${it.warehouse_name}: ${formatCurrent(it)} → ${formatNew}`,
            }));
            Modal.confirm({
                title: t.confirmOverwriteTitle || 'Apply to all warehouses?',
                content: (
                    <div>
                        <div>{t.confirmOverwriteBody || 'The following warehouses will change:'}</div>
                        <ul style={{fontSize: 12, marginTop: 6, paddingInlineStart: 18}}>
                            {lines.map(({key, text}) => <li key={key}>{text}</li>)}
                        </ul>
                    </div>
                ),
                okText: t.yes,
                cancelText: t.no,
                onOk: doApply,
            });
            return;
        }
        await doApply();
    }, [group.items, itemIds, orderId, onLocalOrderUpdate, notify, t]);

    const handleResetGroup = useCallback(() => {
        applyBulk(
            {discount_percent: 0, discounted_price: null},
            group.isMixedDiscount,
            (it) => (it.discounted_price ? `${it.discounted_price} ₾` : `${it.discount_percent}%`),
            '—',
        );
    }, [applyBulk, group.isMixedDiscount]);

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

    // Auto-distribute: debounce typing in the total-qty input, compute the
    // target distribution, diff, and apply via parallel add/update/remove.
    const [pendingTarget, setPendingTarget] = useState(null);
    const distributeTimerRef = useRef(null);
    const groupRef = useRef(group);
    groupRef.current = group;

    const applyDistribution = useCallback(async (target) => {
        // Await the in-flight stock fetch so we never race with it.
        const stockResult = await ensureStock();
        const currentStock = Array.isArray(stockResult) ? stockResult : null;
        const currentGroup = groupRef.current;
        if (currentGroup.items.length === 0) {
            setPendingTarget(null);
            return;
        }

        let distribution;
        if (currentStock && currentStock.some((s) => Number(s.quantity) > 0)) {
            distribution = distributeStock(target, currentStock, assignedCodes);
        } else {
            // No stock data (fetch failed or empty). Fall back: apply the
            // typed value to the first existing line; leave others alone.
            distribution = new Map([[currentGroup.items[0].warehouse_code, target]]);
        }

        const inherited = inheritFromGroup(currentGroup, canApplyDiscount);
        const itemByCode = new Map(currentGroup.items.map((it) => [it.warehouse_code, it]));
        const calls = [];
        for (const [code, qty] of distribution) {
            const existing = itemByCode.get(code);
            if (existing) {
                if (Number(existing.quantity) !== qty) {
                    calls.push(orderService.updateOrderItem(orderId, existing.id, {quantity: qty}));
                }
            } else {
                const stockEntry = currentStock?.find((s) => s.warehouse === code);
                calls.push(orderService.addOrderItem(orderId, {
                    sku: currentGroup.sku,
                    sku_name: currentGroup.sku_name,
                    article: currentGroup.article,
                    price: stockEntry?.price ?? currentGroup.items[0].price ?? 0,
                    quantity: qty,
                    warehouse_code: code,
                    warehouse_name: stockEntry?.warehouse_name || '',
                    ...inherited,
                }));
            }
        }
        // Only remove items when we have real stock data — the fallback path
        // (no stock) must NOT delete the user's existing lines.
        if (currentStock) {
            for (const it of currentGroup.items) {
                if (!distribution.has(it.warehouse_code)) {
                    calls.push(orderService.removeOrderItem(orderId, it.id));
                }
            }
        }
        if (calls.length === 0) {
            setPendingTarget(null);
            return;
        }
        const results = await Promise.all(calls);
        const failed = results.find((r) => !r.success);
        if (failed) {
            notify.error(t.orderError, failed.error);
            return;
        }
        const last = results[results.length - 1].data;
        if (last) onLocalOrderUpdate(last);
        setPendingTarget(null);
    }, [ensureStock, assignedCodes, canApplyDiscount, orderId, onLocalOrderUpdate, notify, t]);

    const onTotalQtyChange = useCallback((val) => {
        if (val == null) return;
        ensureStock();
        setPendingTarget(val);
        if (distributeTimerRef.current) clearTimeout(distributeTimerRef.current);
        distributeTimerRef.current = setTimeout(() => applyDistribution(val), 400);
    }, [ensureStock, applyDistribution]);

    useEffect(() => () => {
        if (distributeTimerRef.current) clearTimeout(distributeTimerRef.current);
    }, []);

    // Eager-fetch stock once per card mount so the in-stock captions and
    // the auto-distribute path are ready before the user types or expands.
    useEffect(() => {
        ensureStock();
    }, [ensureStock]);

    const displayedTotalQty = pendingTarget != null ? pendingTarget : group.totalQty;
    const exceeds = totalStock != null && displayedTotalQty > totalStock;

    const handleSharedPriceChange = (val) => {
        if (val == null || !Number.isFinite(val) || val < 0) return;
        applyBulk(
            {discounted_price: val, discount_percent: 0},
            group.isMixedPrice,
            (it) => `${it.effective_price} ₾`,
            `${val} ₾`,
        );
    };

    const priceArea = (
        <Flex align="center" gap={6}>
            {group.isMixedPrice ? (
                <>
                    <Text type="secondary" style={{fontSize: 12}}>
                        {group.minPrice} ₾ – {group.maxPrice} ₾
                    </Text>
                    <Tag color="orange" style={{fontSize: 10, marginInlineEnd: 0}}>
                        {t.mixed || 'Mixed'}
                    </Tag>
                    <InputNumber
                        size="small"
                        placeholder={t.setPrice}
                        controls={false}
                        addonAfter="₾"
                        onPressEnter={(e) => handleSharedPriceChange(parseFloat(e.target.value))}
                        onBlur={(e) => {
                            const v = parseFloat(e.target.value);
                            if (Number.isFinite(v)) handleSharedPriceChange(v);
                        }}
                        style={{width: 100}}
                    />
                </>
            ) : (
                <InputNumber
                    size="small"
                    value={parseFloat(group.sharedPrice)}
                    controls={false}
                    addonAfter="₾"
                    onPressEnter={(e) => handleSharedPriceChange(parseFloat(e.target.value))}
                    onBlur={(e) => {
                        const v = parseFloat(e.target.value);
                        if (Number.isFinite(v) && v.toFixed(2) !== Number(group.sharedPrice).toFixed(2)) {
                            handleSharedPriceChange(v);
                        }
                    }}
                    style={{width: 100}}
                />
            )}
        </Flex>
    );

    // Render an expanded row per existing order line. The "other warehouses"
    // (stock-positive but not in the order yet) are kept behind an explicit
    // toggle so the cart card stays focused on the user's current cart.
    const stockTextFor = useCallback((code) => {
        if (stockLoading && stock == null) return '…';
        if (stock === 'error') return '—';
        if (!Array.isArray(stock)) return null; // not yet fetched + not loading
        const k = stockByCode.get(code);
        return k != null ? String(k) : '—';
    }, [stock, stockLoading, stockByCode]);

    const lineRows = useMemo(
        () => group.items.map((it) => ({
            key: `line-${it.id}`,
            item: it,
            stockText: null, // resolved at render time via stockTextFor
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
        <div className="m-order-item-card m-order-item-group-card">
            <Flex justify="space-between" align="start" gap={8}>
                <div style={{flex: 1, minWidth: 0}}>
                    <Text strong style={{fontSize: 14, display: 'block'}} ellipsis>
                        {group.sku_name || group.sku}
                    </Text>
                    {group.article && (
                        <Text type="secondary" style={{fontSize: 12}}>
                            {t.article}: {group.article}
                        </Text>
                    )}
                </div>
                <Popconfirm
                    title={t.removeFromAllWarehouses || t.confirmDelete || 'Remove product?'}
                    onConfirm={handleRemoveGroup}
                    okText={t.yes}
                    cancelText={t.no}
                >
                    <Button type="text" danger size="small" icon={<DeleteOutlined/>}
                            className="m-item-delete-btn"/>
                </Popconfirm>
            </Flex>

            {/* Controls zone — does not toggle expand */}
            <Flex align="center" gap={8} style={{marginTop: 8}}>
                <Text type="secondary" style={{fontSize: 12}}>{t.price}:</Text>
                {priceArea}
            </Flex>

            <Flex gap={8} wrap="wrap" align="center" style={{marginTop: 10}}>
                <Text type="secondary" style={{fontSize: 12}}>{t.totalQuantity}:</Text>
                <InputNumber
                    min={0}
                    value={displayedTotalQty}
                    size="small"
                    onChange={onTotalQtyChange}
                    onFocus={ensureStock}
                    controls={false}
                    inputMode="numeric"
                    style={{width: 90}}
                />
                <Select
                    value={group.sharedUnit || undefined}
                    size="small"
                    allowClear
                    showSearch
                    placeholder={group.isMixedUnit ? (t.mixed || 'Mixed') : t.unit}
                    className="m-unit-select"
                    options={unitOptions}
                    onChange={(val) => applyBulk(
                        {unit: val || ''},
                        group.isMixedUnit,
                        (it) => (it.unit || '—'),
                        (val || '—'),
                    )}
                />
                {canApplyDiscount && maxDiscountPercent > 0 && (
                    <SharedDiscountControl
                        group={group}
                        maxDiscountPercent={maxDiscountPercent}
                        applyBulk={applyBulk}
                        onResetGroup={handleResetGroup}
                        t={t}
                    />
                )}
            </Flex>

            {exceeds && (
                <Flex align="center" gap={4} style={{marginTop: 6}}>
                    <WarningOutlined style={{color: '#faad14', fontSize: 12}}/>
                    <Text type="warning" style={{fontSize: 11}}>
                        {t.exceedsStock(totalStock)}
                    </Text>
                </Flex>
            )}

            <Flex justify="end" style={{marginTop: 8}}>
                <Text strong style={{color: '#52c41a', fontSize: 15}}>
                    {group.groupLineTotal} ₾
                </Text>
            </Flex>

            <div className="m-order-item-group-expanded">
                {lineRows.map((row) => (
                    <WarehouseSubRow
                        key={row.key}
                        item={row.item}
                        stockText={stockTextFor(row.item.warehouse_code)}
                        stockNumber={Array.isArray(stock) ? stockByCode.get(row.item.warehouse_code) : null}
                        assigned={row.assigned}
                        orderId={orderId}
                        onLocalOrderUpdate={onLocalOrderUpdate}
                        notify={notify}
                        t={t}
                    />
                ))}

                {otherWarehouses.length > 0 && (
                    <Button
                        type="link"
                        size="small"
                        onClick={() => setShowOtherWarehouses((v) => !v)}
                        style={{padding: 0, marginTop: 4}}
                    >
                        {showOtherWarehouses
                            ? t.hideOtherWarehouses
                            : t.showOtherWarehouses(otherWarehouses.length)}
                    </Button>
                )}

                {showOtherWarehouses && otherWarehouses.map((row) => (
                    <Flex key={row.key} align="center" gap={8} className="m-warehouse-subrow"
                          style={{opacity: 0.6}}>
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
        const result = await orderService.updateOrder(order.id, {delivery_date: dateString || ''});
        if (result.success) {
            onLocalOrderUpdate(result.data);
        } else {
            notify.error(t.orderError, result.error);
        }
    }, [order.id, onLocalOrderUpdate, notify, t]);

    const handleDeliveryTimeFromChange = useCallback(async (time, timeString) => {
        const result = await orderService.updateOrder(order.id, {delivery_time_from: timeString || ''});
        if (result.success) {
            onLocalOrderUpdate(result.data);
        } else {
            notify.error(t.orderError, result.error);
        }
    }, [order.id, onLocalOrderUpdate, notify, t]);

    const handleDeliveryTimeToChange = useCallback(async (time, timeString) => {
        const result = await orderService.updateOrder(order.id, {delivery_time_to: timeString || ''});
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

    return (
        <div style={{marginBottom: 12}}>
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

const OrderPanel = ({order: initialOrder, onSaveForLater, onProceedToPayment, onDeleteOrder, onOrderUpdate, onChangeCustomer, notify, isMobileDrawer}) => {
    const {t} = useLanguage();
    const {authData} = useContext(AuthContext);
    const discountConfig = useMemo(() => ({
        canApplyDiscount: !!authData?.user?.can_apply_discount,
        maxDiscountPercent: parseFloat(authData?.user?.max_discount_percent || 0),
    }), [authData?.user?.can_apply_discount, authData?.user?.max_discount_percent]);
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

    useEffect(() => {
        // Always sync if order ID changed (different order loaded)
        if (initialOrder?.id !== lastOrderIdRef.current) {
            setLocalOrder(initialOrder);
            lastOrderIdRef.current = initialOrder?.id;
            lastItemCountRef.current = initialOrder?.items?.length || 0;
            setStep(1);
            return;
        }
        // Sync if items were added from outside (item count increased externally)
        const newItemCount = initialOrder?.items?.length || 0;
        if (newItemCount !== lastItemCountRef.current) {
            setLocalOrder(initialOrder);
            lastItemCountRef.current = newItemCount;
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
                        <Text strong>{localOrder.customer_name}</Text>
                    </Flex>
                </Card>
            )}

            {/* Customer info (in drawer mode) */}
            {isMobileDrawer && (
                <Flex align="center" gap={8} className="m-customer-bar">
                    <UserOutlined style={{color: '#1677ff'}}/>
                    <Text strong>{localOrder.customer_name}</Text>
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
                            disabled={!hasItems}
                        >
                            <Button
                                type="primary"
                                icon={<DollarOutlined/>}
                                disabled={!hasItems}
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

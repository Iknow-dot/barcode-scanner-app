import React, {useState, useCallback, useEffect, useRef, memo} from 'react';
import dayjs from 'dayjs';
import {useLanguage} from '../../i18n/LanguageContext';
import {orderService} from '../../api';
import {
    Card,
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
    Divider,
    Collapse,
    Select,
    Dropdown,
    Modal,
} from 'antd';
import {
    ShoppingCartOutlined,
    DeleteOutlined,
    UserOutlined,
    SaveOutlined,
    DollarOutlined,
    CarOutlined,
    ShopOutlined,
    EnvironmentOutlined,
    CommentOutlined,
    MinusOutlined,
    PlusOutlined,
    MoreOutlined,
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

// Memoized order item card component
const OrderItemCard = memo(({
    item,
    orderId,
    onLocalOrderUpdate,
    notify,
    t,
    unitOptions,
}) => {
    const handleQuantityChange = useCallback(async (newQuantity) => {
        if (newQuantity < 1) return;
        const result = await orderService.updateOrderItem(orderId, item.id, {quantity: newQuantity});
        if (result.success) {
            onLocalOrderUpdate(result.data);
        } else {
            notify.error(t.orderError, result.error);
        }
    }, [orderId, item.id, onLocalOrderUpdate, notify, t]);

    const handleUnitChange = useCallback(async (newUnit) => {
        const result = await orderService.updateOrderItem(orderId, item.id, {unit: newUnit || ''});
        if (result.success) {
            onLocalOrderUpdate(result.data);
        } else {
            notify.error(t.orderError, result.error);
        }
    }, [orderId, item.id, onLocalOrderUpdate, notify, t]);

    const handleDiscountChange = useCallback(async (field, value) => {
        const data = {};
        if (field === 'discount_percent') {
            data.discount_percent = value || 0;
            data.discounted_price = null;
        } else if (field === 'discounted_price') {
            data.discounted_price = value || null;
            data.discount_percent = 0;
        }
        const result = await orderService.updateOrderItem(orderId, item.id, data);
        if (result.success) {
            onLocalOrderUpdate(result.data);
        } else {
            notify.error(t.orderError, result.error);
        }
    }, [orderId, item.id, onLocalOrderUpdate, notify, t]);

    const handleRemoveItem = useCallback(async () => {
        const result = await orderService.removeOrderItem(orderId, item.id);
        if (result.success) {
            onLocalOrderUpdate(result.data);
        } else {
            notify.error(t.orderError, result.error);
        }
    }, [orderId, item.id, onLocalOrderUpdate, notify, t]);

    return (
        <div className="m-order-item-card">
            {/* Item header: name + delete */}
            <Flex justify="space-between" align="start" gap={8}>
                <div style={{flex: 1, minWidth: 0}}>
                    <Text strong style={{fontSize: 14, display: 'block'}} ellipsis>
                        {item.sku_name || item.sku}
                    </Text>
                    {item.article && (
                        <Text type="secondary" style={{fontSize: 12}}>
                            {t.article}: {item.article}
                        </Text>
                    )}
                    {item.warehouse_name && (
                        <div style={{marginTop: 2}}>
                            <Tag style={{fontSize: 10}} color="blue">
                                {item.warehouse_name}
                            </Tag>
                        </div>
                    )}
                </div>
                <Popconfirm
                    title={t.confirmDelete}
                    onConfirm={handleRemoveItem}
                    okText={t.yes}
                    cancelText={t.no}
                >
                    <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined/>}
                        className="m-item-delete-btn"
                    />
                </Popconfirm>
            </Flex>

            {/* Price row */}
            <Flex align="center" gap={8} style={{marginTop: 8}}>
                <Text type="secondary" style={{fontSize: 12}}>{t.price}:</Text>
                {item.effective_price && parseFloat(item.effective_price) !== parseFloat(item.price) ? (
                    <Flex align="center" gap={4}>
                        <Text delete type="secondary" style={{fontSize: 12}}>{item.price} ₾</Text>
                        <Text strong style={{color: '#52c41a', fontSize: 13}}>{item.effective_price} ₾</Text>
                    </Flex>
                ) : (
                    <Text style={{fontWeight: 500, fontSize: 13}}>{item.price} ₾</Text>
                )}
            </Flex>

            {/* Controls row: quantity, unit, discount */}
            <Flex gap={8} wrap="wrap" align="center" style={{marginTop: 10}}>
                {/* Quantity stepper */}
                <div className="m-qty-stepper">
                    <Button
                        size="small"
                        icon={<MinusOutlined/>}
                        onClick={() => handleQuantityChange(item.quantity - 1)}
                        disabled={item.quantity <= 1}
                        className="m-qty-btn"
                    />
                    <InputNumber
                        min={1}
                        value={item.quantity}
                        size="small"
                        onChange={handleQuantityChange}
                        className="m-qty-input"
                        controls={false}
                        inputMode="numeric"
                        pattern="[0-9]*"
                    />
                    <Button
                        size="small"
                        icon={<PlusOutlined/>}
                        onClick={() => handleQuantityChange(item.quantity + 1)}
                        className="m-qty-btn"
                    />
                </div>

                {/* Unit select */}
                <Select
                    value={item.unit || undefined}
                    size="small"
                    allowClear
                    showSearch
                    placeholder={t.unit}
                    onChange={handleUnitChange}
                    className="m-unit-select"
                    options={unitOptions}
                />

                {/* Discount */}
                <Flex align="center" gap={4}>
                    <InputNumber
                        min={0}
                        max={100}
                        value={item.discount_percent || 0}
                        size="small"
                        onChange={(val) => handleDiscountChange('discount_percent', val)}
                        className="m-discount-input"
                        controls={false}
                        inputMode="decimal"
                    />
                    <Text type="secondary" style={{fontSize: 12}}>%</Text>
                </Flex>
            </Flex>

            {/* Line total */}
            <Flex justify="end" style={{marginTop: 8}}>
                <Text strong style={{color: '#52c41a', fontSize: 15}}>
                    {item.line_total} ₾
                </Text>
            </Flex>
        </div>
    );
});

OrderItemCard.displayName = 'OrderItemCard';

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

const OrderPanel = ({order: initialOrder, onSaveForLater, onProceedToPayment, onDeleteOrder, onOrderUpdate, notify, isMobileDrawer}) => {
    const {t} = useLanguage();
    // Keep order state LOCAL so updates don't re-render the parent (and the Drawer)
    const [localOrder, setLocalOrder] = useState(initialOrder);
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
            {
                key: 'save',
                label: t.saveForLater,
                icon: <SaveOutlined/>,
                onClick: onSaveForLater,
            },
            {type: 'divider'},
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
        <Dropdown menu={orderActionsMenu} trigger={['click']} placement="bottomRight">
            <Button
                icon={<MoreOutlined style={{fontSize: 20}}/>}
                type="text"
                aria-label={t.moreActions || 'More actions'}
            />
        </Dropdown>
    );

    return (
        <div className={`m-order-panel ${isMobileDrawer ? 'm-order-panel-drawer' : ''}`}>
            {/* Drawer mode: actions menu floats at top-right (drawer header has no extras) */}
            {isMobileDrawer && (
                <Flex justify="flex-end" style={{marginBottom: 4, marginTop: -4}}>
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

            {/* Items */}
            {hasItems ? (
                <>
                    <div className="m-order-items-list">
                        {localOrder.items.map((item) => (
                            <OrderItemCard
                                key={item.id}
                                item={item}
                                orderId={localOrder.id}
                                onLocalOrderUpdate={handleLocalOrderUpdate}
                                notify={notify}
                                t={t}
                                unitOptions={unitOptions}
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
            )}

            {/* Delivery Conditions */}
            <Divider style={{margin: '12px 0 8px'}}/>
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

            {/* Primary CTA — Save / Delete are in the actions menu (top-right) */}
            <div className="m-order-actions">
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
                        className="m-order-action-btn"
                        size="large"
                        block
                    >
                        {t.proceedToPayment}
                    </Button>
                </Popconfirm>
            </div>
        </div>
    );
};

OrderPanel.displayName = 'OrderPanel';

export default OrderPanel;

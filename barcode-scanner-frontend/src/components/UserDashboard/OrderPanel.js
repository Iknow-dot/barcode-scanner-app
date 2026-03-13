import React, {useState} from 'react';
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

const OrderPanel = ({order, onSaveForLater, onProceedToPayment, onDeleteOrder, onOrderUpdate, notify, isMobileDrawer}) => {
    const {t} = useLanguage();
    const [deliveryExpanded, setDeliveryExpanded] = useState(
        order?.delivery_type === 'delivery' ? ['delivery'] : []
    );

    if (!order) return null;

    const hasItems = order.items && order.items.length > 0;

    const handleQuantityChange = async (itemId, newQuantity) => {
        if (newQuantity < 1) return;
        const result = await orderService.updateOrderItem(order.id, itemId, {quantity: newQuantity});
        if (result.success) {
            onOrderUpdate(result.data);
        } else {
            notify.error(t.orderError, result.error);
        }
    };

    const handleUnitChange = async (itemId, newUnit) => {
        const result = await orderService.updateOrderItem(order.id, itemId, {unit: newUnit || ''});
        if (result.success) {
            onOrderUpdate(result.data);
        } else {
            notify.error(t.orderError, result.error);
        }
    };

    const handleDiscountChange = async (itemId, field, value) => {
        const data = {};
        if (field === 'discount_percent') {
            data.discount_percent = value || 0;
            data.discounted_price = null;
        } else if (field === 'discounted_price') {
            data.discounted_price = value || null;
            data.discount_percent = 0;
        }
        const result = await orderService.updateOrderItem(order.id, itemId, data);
        if (result.success) {
            onOrderUpdate(result.data);
        } else {
            notify.error(t.orderError, result.error);
        }
    };

    const handleRemoveItem = async (itemId) => {
        const result = await orderService.removeOrderItem(order.id, itemId);
        if (result.success) {
            onOrderUpdate(result.data);
            notify.success(t.success, t.orderItemRemoved);
        } else {
            notify.error(t.orderError, result.error);
        }
    };

    const handleDeliveryTypeChange = async (e) => {
        const deliveryType = e.target.value;
        const result = await orderService.updateOrder(order.id, {delivery_type: deliveryType});
        if (result.success) {
            onOrderUpdate(result.data);
            setDeliveryExpanded(deliveryType === 'delivery' ? ['delivery'] : []);
        } else {
            notify.error(t.orderError, result.error);
        }
    };

    const handleDeliveryFieldChange = async (field, value) => {
        const data = {[field]: value || ''};
        const result = await orderService.updateOrder(order.id, data);
        if (result.success) {
            onOrderUpdate(result.data);
        } else {
            notify.error(t.orderError, result.error);
        }
    };

    const handleNotesChange = async (value) => {
        const result = await orderService.updateOrder(order.id, {notes: value || ''});
        if (result.success) {
            onOrderUpdate(result.data);
        } else {
            notify.error(t.orderError, result.error);
        }
    };

    const unitOptions = t.unitOptions || UNIT_OPTIONS;

    // Mobile-friendly item card
    const renderItemCard = (item) => (
        <div key={item.id} className="m-order-item-card">
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
                    onConfirm={() => handleRemoveItem(item.id)}
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
                        onClick={() => handleQuantityChange(item.id, item.quantity - 1)}
                        disabled={item.quantity <= 1}
                        className="m-qty-btn"
                    />
                    <InputNumber
                        min={1}
                        value={item.quantity}
                        size="small"
                        onChange={(val) => handleQuantityChange(item.id, val)}
                        className="m-qty-input"
                        controls={false}
                    />
                    <Button
                        size="small"
                        icon={<PlusOutlined/>}
                        onClick={() => handleQuantityChange(item.id, item.quantity + 1)}
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
                    onChange={(val) => handleUnitChange(item.id, val)}
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
                        onChange={(val) => handleDiscountChange(item.id, 'discount_percent', val)}
                        className="m-discount-input"
                        controls={false}
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

    return (
        <div className={`m-order-panel ${isMobileDrawer ? 'm-order-panel-drawer' : ''}`}>
            {/* Header (only show when not in drawer - drawer has its own header) */}
            {!isMobileDrawer && (
                <Card
                    size="small"
                    className="m-order-header-card"
                    styles={{header: {overflow: 'visible'}}}
                    title={
                        <Flex align="center" gap={12} style={{paddingTop: 4, paddingBottom: 4}}>
                            <Badge count={order.items?.length || 0} size="small" overflowCount={99}>
                                <ShoppingCartOutlined style={{fontSize: 18, color: '#1677ff'}}/>
                            </Badge>
                            <span style={{fontWeight: 600}}>{t.activeOrder} #{order.id}</span>
                            <Tag color="blue">{t.orderDraft}</Tag>
                        </Flex>
                    }
                >
                    {/* Customer info */}
                    <Flex align="center" gap={8} className="m-customer-bar">
                        <UserOutlined style={{color: '#1677ff'}}/>
                        <Text strong>{order.customer_name}</Text>
                    </Flex>
                </Card>
            )}

            {/* Customer info (in drawer mode) */}
            {isMobileDrawer && (
                <Flex align="center" gap={8} className="m-customer-bar">
                    <UserOutlined style={{color: '#1677ff'}}/>
                    <Text strong>{order.customer_name}</Text>
                </Flex>
            )}

            {/* Items */}
            {hasItems ? (
                <>
                    <div className="m-order-items-list">
                        {order.items.map((item) => renderItemCard(item))}
                    </div>

                    {/* Order Total */}
                    <div className="m-order-total-bar">
                        <Text style={{fontSize: 15}}>{t.orderTotal}:</Text>
                        <Title level={4} style={{margin: 0, color: '#52c41a'}}>
                            {order.total} ₾
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
                                        value={order.delivery_address || ''}
                                        onChange={(e) => handleDeliveryFieldChange('delivery_address', e.target.value)}
                                        prefix={<EnvironmentOutlined style={{opacity: 0.4}}/>}
                                        size="large"
                                    />
                                    <DatePicker
                                        placeholder={t.deliveryDate}
                                        size="large"
                                        style={{width: '100%'}}
                                        onChange={(date, dateString) => handleDeliveryFieldChange('delivery_date', dateString)}
                                    />
                                    <Flex gap={8}>
                                        <TimePicker
                                            placeholder={t.deliveryTimeFrom}
                                            format="HH:mm"
                                            size="large"
                                            style={{flex: 1}}
                                            onChange={(time, timeString) => handleDeliveryFieldChange('delivery_time_from', timeString)}
                                        />
                                        <TimePicker
                                            placeholder={t.deliveryTimeTo}
                                            format="HH:mm"
                                            size="large"
                                            style={{flex: 1}}
                                            onChange={(time, timeString) => handleDeliveryFieldChange('delivery_time_to', timeString)}
                                        />
                                    </Flex>
                                    <TextArea
                                        placeholder={t.deliveryNotes}
                                        value={order.delivery_notes || ''}
                                        onChange={(e) => handleDeliveryFieldChange('delivery_notes', e.target.value)}
                                        rows={2}
                                        size="large"
                                    />
                                </Space>
                            ),
                        }]}
                    />
                )}
            </div>

            {/* Order Notes */}
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
                            value={order.notes || ''}
                            onChange={(e) => handleNotesChange(e.target.value)}
                            rows={3}
                            size="large"
                        />
                    ),
                }]}
            />

            {/* Action buttons */}
            <div className="m-order-actions">
                <Flex gap={8} wrap="wrap">
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
                    <div className="m-order-actions-secondary">
                        <Button
                            icon={<SaveOutlined/>}
                            onClick={onSaveForLater}
                            className="m-order-action-btn"
                            size="large"
                            style={{flex: 1}}
                        >
                            {t.saveForLater}
                        </Button>
                        <Popconfirm
                            title={t.confirmDeleteOrder}
                            onConfirm={onDeleteOrder}
                            okText={t.yes}
                            cancelText={t.no}
                        >
                            <Button
                                danger
                                icon={<DeleteOutlined/>}
                                className="m-order-action-btn"
                                size="large"
                            />
                        </Popconfirm>
                    </div>
                </Flex>
            </div>
        </div>
    );
};

export default OrderPanel;

import React, {useState} from 'react';
import {useLanguage} from '../../i18n/LanguageContext';
import {orderService} from '../../api';
import {
    Card,
    Table,
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

const OrderPanel = ({order, onSaveForLater, onProceedToPayment, onDeleteOrder, onOrderUpdate, notify}) => {
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
            data.discounted_price = null; // Clear discounted_price when using percent
        } else if (field === 'discounted_price') {
            data.discounted_price = value || null;
            data.discount_percent = 0; // Clear percent when using direct price
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

    const columns = [
        {
            title: t.product,
            dataIndex: 'sku_name',
            key: 'sku_name',
            render: (name, record) => (
                <div>
                    <Text strong style={{fontSize: 13}}>{name || record.sku}</Text>
                    {record.article && (
                        <div>
                            <Text type="secondary" style={{fontSize: 11}}>
                                {t.article}: {record.article}
                            </Text>
                        </div>
                    )}
                    {record.warehouse_name && (
                        <div>
                            <Tag style={{fontSize: 10, marginTop: 2}} color="blue">
                                {record.warehouse_name}
                            </Tag>
                        </div>
                    )}
                </div>
            ),
        },
        {
            title: t.price,
            dataIndex: 'price',
            key: 'price',
            align: 'right',
            width: 80,
            render: (price, record) => (
                <div>
                    {record.effective_price && parseFloat(record.effective_price) !== parseFloat(price) ? (
                        <>
                            <Text delete type="secondary" style={{fontSize: 11}}>{price} ₾</Text>
                            <br/>
                            <Text strong style={{color: '#52c41a', fontSize: 13}}>{record.effective_price} ₾</Text>
                        </>
                    ) : (
                        <Text style={{fontWeight: 500}}>{price} ₾</Text>
                    )}
                </div>
            ),
        },
        {
            title: t.unit,
            dataIndex: 'unit',
            key: 'unit',
            align: 'center',
            width: 110,
            render: (unit, record) => (
                <Select
                    value={unit || undefined}
                    size="small"
                    allowClear
                    showSearch
                    placeholder={t.unit}
                    onChange={(val) => handleUnitChange(record.id, val)}
                    style={{width: 95}}
                    options={unitOptions}
                />
            ),
        },
        {
            title: t.quantity,
            dataIndex: 'quantity',
            key: 'quantity',
            align: 'center',
            width: 100,
            render: (qty, record) => (
                <InputNumber
                    min={1}
                    value={qty}
                    size="small"
                    onChange={(val) => handleQuantityChange(record.id, val)}
                    style={{width: 65}}
                />
            ),
        },
        {
            title: t.discountPercent,
            key: 'discount',
            align: 'center',
            width: 80,
            render: (_, record) => (
                <InputNumber
                    min={0}
                    max={100}
                    value={record.discount_percent || 0}
                    size="small"
                    onChange={(val) => handleDiscountChange(record.id, 'discount_percent', val)}
                    style={{width: 60}}
                    suffix="%"
                />
            ),
        },
        {
            title: t.lineTotal,
            dataIndex: 'line_total',
            key: 'line_total',
            align: 'right',
            width: 90,
            render: (total) => (
                <Text strong style={{color: '#52c41a'}}>{total} ₾</Text>
            ),
        },
        {
            title: '',
            key: 'actions',
            width: 40,
            render: (_, record) => (
                <Popconfirm
                    title={t.confirmDelete}
                    onConfirm={() => handleRemoveItem(record.id)}
                    okText={t.yes}
                    cancelText={t.no}
                >
                    <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined/>}
                    />
                </Popconfirm>
            ),
        },
    ];

    return (
        <Card
            size="small"
            style={{marginBottom: 16, overflow: 'visible'}}
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
            <Flex align="center" gap={8} style={{marginBottom: 12, padding: '8px 12px', background: 'rgba(22, 119, 255, 0.04)', borderRadius: 8}}>
                <UserOutlined style={{color: '#1677ff'}}/>
                <Text strong>{order.customer_name}</Text>
            </Flex>

            {/* Items table */}
            {hasItems ? (
                <>
                    <Table
                        dataSource={order.items.map((item) => ({...item, key: item.id}))}
                        columns={columns}
                        size="small"
                        pagination={false}
                        style={{marginBottom: 12}}
                        scroll={{x: 'max-content'}}
                    />
                    <Flex justify="end" style={{padding: '8px 12px', background: 'rgba(82, 196, 26, 0.06)', borderRadius: 8, marginBottom: 12}}>
                        <Space size={8}>
                            <Text style={{fontSize: 15}}>{t.orderTotal}:</Text>
                            <Title level={4} style={{margin: 0, color: '#52c41a'}}>
                                {order.total} ₾
                            </Title>
                        </Space>
                    </Flex>
                </>
            ) : (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                        <span style={{opacity: 0.6}}>{t.scanToAddProduct}</span>
                    }
                    style={{margin: '16px 0'}}
                />
            )}

            {/* Delivery Conditions */}
            <Divider style={{margin: '12px 0 8px'}} />
            <div style={{marginBottom: 12}}>
                <Flex align="center" gap={8} style={{marginBottom: 8}}>
                    <CarOutlined style={{color: '#1677ff'}}/>
                    <Text strong>{t.deliveryType}</Text>
                </Flex>
                <Radio.Group
                    value={order.delivery_type || 'pickup'}
                    onChange={handleDeliveryTypeChange}
                    buttonStyle="solid"
                    size="small"
                    style={{marginBottom: 8}}
                >
                    <Radio.Button value="pickup">
                        <ShopOutlined/> {t.pickup}
                    </Radio.Button>
                    <Radio.Button value="delivery">
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
                                        size="small"
                                    />
                                    <Flex gap={8}>
                                        <DatePicker
                                            placeholder={t.deliveryDate}
                                            size="small"
                                            style={{flex: 1}}
                                            onChange={(date, dateString) => handleDeliveryFieldChange('delivery_date', dateString)}
                                        />
                                    </Flex>
                                    <Flex gap={8}>
                                        <TimePicker
                                            placeholder={t.deliveryTimeFrom}
                                            format="HH:mm"
                                            size="small"
                                            style={{flex: 1}}
                                            onChange={(time, timeString) => handleDeliveryFieldChange('delivery_time_from', timeString)}
                                        />
                                        <TimePicker
                                            placeholder={t.deliveryTimeTo}
                                            format="HH:mm"
                                            size="small"
                                            style={{flex: 1}}
                                            onChange={(time, timeString) => handleDeliveryFieldChange('delivery_time_to', timeString)}
                                        />
                                    </Flex>
                                    <TextArea
                                        placeholder={t.deliveryNotes}
                                        value={order.delivery_notes || ''}
                                        onChange={(e) => handleDeliveryFieldChange('delivery_notes', e.target.value)}
                                        rows={2}
                                        size="small"
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
                            size="small"
                        />
                    ),
                }]}
            />

            {/* Action buttons: Delete, Save for Later & Proceed to Payment */}
            <Flex gap={8} wrap="wrap" style={{marginTop: 12}}>
                <Popconfirm
                    title={t.confirmDeleteOrder}
                    onConfirm={onDeleteOrder}
                    okText={t.yes}
                    cancelText={t.no}
                >
                    <Button
                        danger
                        icon={<DeleteOutlined/>}
                        style={{borderRadius: 8}}
                        size="middle"
                    />
                </Popconfirm>
                <Button
                    icon={<SaveOutlined/>}
                    onClick={onSaveForLater}
                    style={{flex: 1, borderRadius: 8}}
                    size="middle"
                >
                    {t.saveForLater}
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
                        style={{flex: 1, borderRadius: 8}}
                        size="middle"
                    >
                        {t.proceedToPayment}
                    </Button>
                </Popconfirm>
            </Flex>
        </Card>
    );
};

export default OrderPanel;

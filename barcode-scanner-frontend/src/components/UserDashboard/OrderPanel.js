import React from 'react';
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
} from 'antd';
import {
    ShoppingCartOutlined,
    DeleteOutlined,
    UserOutlined,
    SaveOutlined,
    DollarOutlined,
} from '@ant-design/icons';

const {Text, Title} = Typography;

const OrderPanel = ({order, onSaveForLater, onProceedToPayment, onDeleteOrder, onOrderUpdate, notify}) => {
    const {t} = useLanguage();

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

    const handleRemoveItem = async (itemId) => {
        const result = await orderService.removeOrderItem(order.id, itemId);
        if (result.success) {
            onOrderUpdate(result.data);
            notify.success(t.success, t.orderItemRemoved);
        } else {
            notify.error(t.orderError, result.error);
        }
    };

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
                </div>
            ),
        },
        {
            title: t.price,
            dataIndex: 'price',
            key: 'price',
            align: 'right',
            width: 80,
            render: (price) => (
                <Text style={{fontWeight: 500}}>{price} ₾</Text>
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
                <Flex align="center" gap={12}>
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

            {/* Action buttons: Delete, Save for Later & Proceed to Payment */}
            <Flex gap={8} wrap="wrap">
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

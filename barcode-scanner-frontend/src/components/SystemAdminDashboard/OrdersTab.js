import React, {useState, useEffect, useCallback} from 'react';
import {orderService} from '../../api';
import {useLanguage} from '../../i18n/LanguageContext';
import useAppNotification from '../../hooks/useAppNotification';
import {
    Table,
    Tag,
    Typography,
    Flex,
    Button,
    Select,
    Popconfirm,
    Empty,
    Space,
} from 'antd';
import {
    DeleteOutlined,
    ReloadOutlined,
    UserOutlined,
    ShoppingCartOutlined,
} from '@ant-design/icons';

const {Text} = Typography;

const STATUS_COLOR_MAP = {
    draft: 'orange',
    confirmed: 'green',
    cancelled: 'red',
};

const OrdersTab = () => {
    const {t} = useLanguage();
    const {notify, contextHolder} = useAppNotification();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState(null);

    const fetchOrders = useCallback(async () => {
        setLoading(true);
        try {
            const result = await orderService.getOrders();
            if (result.success) {
                setOrders(Array.isArray(result.data) ? result.data : result.data?.results || []);
            } else {
                notify.error(t.error, t.dataFetchError);
            }
        } catch (err) {
            console.error('Failed to fetch orders:', err);
            notify.error(t.error, t.dataFetchError);
        } finally {
            setLoading(false);
        }
    }, [t, notify]);

    useEffect(() => {
        fetchOrders();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleDeleteOrder = async (orderId) => {
        const result = await orderService.deleteOrder(orderId);
        if (result.success) {
            notify.success(t.success, t.orderDeleted);
            setOrders((prev) => prev.filter((o) => o.id !== orderId));
        } else {
            notify.error(t.orderError, result.error);
        }
    };

    const getStatusLabel = (status) => {
        const map = {
            draft: t.orderDraft,
            confirmed: t.orderConfirmed,
            cancelled: t.orderCancelled,
        };
        return map[status] || status;
    };

    const filteredOrders = statusFilter
        ? orders.filter((o) => o.status === statusFilter)
        : orders;

    const columns = [
        {
            title: '#',
            dataIndex: 'id',
            key: 'id',
            width: 70,
            sorter: (a, b) => a.id - b.id,
            render: (id) => <Text strong>#{id}</Text>,
        },
        {
            title: t.customer,
            dataIndex: 'customer_name',
            key: 'customer_name',
            render: (name) => (
                <Flex align="center" gap={6}>
                    <UserOutlined style={{opacity: 0.4}}/>
                    <Text>{name}</Text>
                </Flex>
            ),
        },
        {
            title: t.orderStatus,
            dataIndex: 'status',
            key: 'status',
            width: 130,
            filters: [
                {text: t.orderDraft, value: 'draft'},
                {text: t.orderConfirmed, value: 'confirmed'},
                {text: t.orderCancelled, value: 'cancelled'},
            ],
            onFilter: (value, record) => record.status === value,
            render: (status) => (
                <Tag color={STATUS_COLOR_MAP[status] || 'default'}>
                    {getStatusLabel(status)}
                </Tag>
            ),
        },
        {
            title: t.items,
            dataIndex: 'items_count',
            key: 'items_count',
            width: 90,
            align: 'center',
            sorter: (a, b) => (a.items_count || 0) - (b.items_count || 0),
            render: (count) => (
                <Flex align="center" justify="center" gap={4}>
                    <ShoppingCartOutlined style={{opacity: 0.4, fontSize: 13}}/>
                    <Text>{count || 0}</Text>
                </Flex>
            ),
        },
        {
            title: t.orderTotal,
            dataIndex: 'total',
            key: 'total',
            width: 110,
            align: 'right',
            sorter: (a, b) => parseFloat(a.total || 0) - parseFloat(b.total || 0),
            render: (total) => (
                <Text strong style={{color: '#52c41a'}}>
                    {total} ₾
                </Text>
            ),
        },
        {
            title: t.createdBy,
            dataIndex: 'created_by_username',
            key: 'created_by_username',
            width: 130,
            render: (username) => <Text type="secondary">{username}</Text>,
        },
        {
            title: t.orderDate,
            dataIndex: 'created_at',
            key: 'created_at',
            width: 130,
            sorter: (a, b) => new Date(a.created_at) - new Date(b.created_at),
            defaultSortOrder: 'descend',
            render: (date) => (
                <Text type="secondary" style={{fontSize: 12}}>
                    {new Date(date).toLocaleDateString()}{' '}
                    {new Date(date).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                </Text>
            ),
        },
        {
            title: '',
            key: 'actions',
            width: 50,
            align: 'center',
            render: (_, record) => (
                <Popconfirm
                    title={t.confirmDelete}
                    onConfirm={() => handleDeleteOrder(record.id)}
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
        <>
            {contextHolder}

            {/* Toolbar */}
            <Flex justify="space-between" align="center" wrap="wrap" gap={12} style={{marginBottom: 16}}>
                <Space size={12}>
                    <Select
                        placeholder={t.allStatuses}
                        allowClear
                        value={statusFilter}
                        onChange={setStatusFilter}
                        style={{width: 160}}
                        options={[
                            {label: t.orderDraft, value: 'draft'},
                            {label: t.orderConfirmed, value: 'confirmed'},
                            {label: t.orderCancelled, value: 'cancelled'},
                        ]}
                    />
                </Space>
                <Button
                    icon={<ReloadOutlined/>}
                    onClick={fetchOrders}
                    loading={loading}
                >
                    {t.loading.replace('...', '')}
                </Button>
            </Flex>

            {/* Orders Table */}
            <Table
                dataSource={filteredOrders.map((o) => ({...o, key: o.id}))}
                columns={columns}
                loading={loading}
                size="middle"
                pagination={{pageSize: 15, showSizeChanger: true, pageSizeOptions: ['10', '15', '25', '50']}}
                locale={{
                    emptyText: (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description={t.noOrders}
                        />
                    ),
                }}
            />
        </>
    );
};

export default OrdersTab;

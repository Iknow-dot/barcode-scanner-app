import React, {useState, useEffect, useCallback} from 'react';
import {orderService} from '../../api';
import {useLanguage} from '../../i18n/LanguageContext';
import useAppNotification from '../../hooks/useAppNotification';
import {printInvoice} from '../../utils/printInvoice';
import displayCustomerName from '../../utils/orderDisplay';
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
    Input,
    DatePicker,
    Card,
    Descriptions,
    Divider,
    Modal,
} from 'antd';
import {
    DeleteOutlined,
    ReloadOutlined,
    UserOutlined,
    ShoppingCartOutlined,
    SearchOutlined,
    EyeOutlined,
    CarOutlined,
    ShopOutlined,
    EnvironmentOutlined,
    CalendarOutlined,
    ClockCircleOutlined,
    CommentOutlined,
    FilterOutlined,
    PrinterOutlined,
} from '@ant-design/icons';

const {Text, Title} = Typography;
const {RangePicker} = DatePicker;

const STATUS_COLOR_MAP = {
    draft: 'orange',
    confirmed: 'green',
    cancelled: 'red',
};

const DELIVERY_TYPE_ICON = {
    pickup: <ShopOutlined/>,
    delivery: <CarOutlined/>,
};

const OrdersTab = () => {
    const {t} = useLanguage();
    const {notify, contextHolder} = useAppNotification();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);

    // Filters
    const [statusFilter, setStatusFilter] = useState(null);
    const [customerSearch, setCustomerSearch] = useState('');
    const [orderNumberSearch, setOrderNumberSearch] = useState('');
    const [dateRange, setDateRange] = useState(null);

    // Detail modal
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const buildParams = useCallback(() => {
        const params = {};
        if (statusFilter) params.status = statusFilter;
        if (customerSearch) params.customer_search = customerSearch;
        if (orderNumberSearch) params.order_number = orderNumberSearch;
        if (dateRange && dateRange[0]) params.date_from = dateRange[0].format('YYYY-MM-DD');
        if (dateRange && dateRange[1]) params.date_to = dateRange[1].format('YYYY-MM-DD');
        return params;
    }, [statusFilter, customerSearch, orderNumberSearch, dateRange]);

    const fetchOrders = useCallback(async () => {
        setLoading(true);
        try {
            const params = buildParams();
            const result = await orderService.getOrders(params);
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
    }, [t, notify, buildParams]);

    useEffect(() => {
        fetchOrders();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSearch = () => {
        fetchOrders();
    };

    const handleDeleteOrder = async (orderId) => {
        const result = await orderService.deleteOrder(orderId);
        if (result.success) {
            notify.success(t.success, t.orderDeleted);
            setOrders((prev) => prev.filter((o) => o.id !== orderId));
        } else {
            notify.error(t.orderError, result.error);
        }
    };

    const handleViewDetails = async (orderId) => {
        setDetailLoading(true);
        setDetailModalOpen(true);
        try {
            const result = await orderService.getOrder(orderId);
            if (result.success) {
                setSelectedOrder(result.data);
            } else {
                notify.error(t.error, t.dataFetchError);
            }
        } catch (err) {
            console.error('Failed to fetch order details:', err);
        } finally {
            setDetailLoading(false);
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

    const getDeliveryLabel = (type) => {
        const map = {
            pickup: t.pickup,
            delivery: t.delivery,
        };
        return map[type] || type;
    };

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
            render: (name, record) => (
                <Flex align="center" gap={6}>
                    <UserOutlined style={{opacity: 0.4}}/>
                    <Text>{displayCustomerName(record, t)}</Text>
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
            title: t.deliveryType,
            dataIndex: 'delivery_type',
            key: 'delivery_type',
            width: 120,
            render: (type) => (
                <Tag icon={DELIVERY_TYPE_ICON[type]} color={type === 'delivery' ? 'blue' : 'default'}>
                    {getDeliveryLabel(type)}
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
            width: 110,
            align: 'center',
            render: (_, record) => (
                <Space size={4}>
                    <Button
                        type="text"
                        size="small"
                        icon={<EyeOutlined/>}
                        onClick={() => handleViewDetails(record.id)}
                        title={t.viewDetails}
                    />
                    <Button
                        type="text"
                        size="small"
                        icon={<PrinterOutlined/>}
                        onClick={() => printInvoice(record.id, t, notify)}
                        title={t.printInvoice}
                    />
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
                </Space>
            ),
        },
    ];

    // Item columns for the detail modal
    const itemColumns = [
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
            title: t.warehouseSource,
            dataIndex: 'warehouse_name',
            key: 'warehouse_name',
            width: 120,
            render: (name) => name ? <Tag color="blue">{name}</Tag> : <Text type="secondary">—</Text>,
        },
        {
            title: t.unitOfMeasure,
            dataIndex: 'unit',
            key: 'unit',
            width: 80,
            render: (unit) => {
                if (!unit) return '—';
                const unitOption = (t.unitOptions || []).find(opt => opt.value === unit);
                return unitOption ? unitOption.label : unit;
            },
        },
        {
            title: t.originalPrice,
            dataIndex: 'price',
            key: 'price',
            align: 'right',
            width: 100,
            render: (price) => <Text>{price} ₾</Text>,
        },
        {
            title: t.discountPercent,
            dataIndex: 'discount_percent',
            key: 'discount_percent',
            align: 'center',
            width: 80,
            render: (pct) => pct > 0 ? <Tag color="red">-{pct}%</Tag> : <Text type="secondary">—</Text>,
        },
        {
            title: t.effectivePrice,
            dataIndex: 'effective_price',
            key: 'effective_price',
            align: 'right',
            width: 100,
            render: (price, record) => {
                const hasDiscount = parseFloat(record.effective_price) !== parseFloat(record.price);
                return hasDiscount
                    ? <Text strong style={{color: '#52c41a'}}>{price} ₾</Text>
                    : <Text>{price} ₾</Text>;
            },
        },
        {
            title: t.quantity,
            dataIndex: 'quantity',
            key: 'quantity',
            align: 'center',
            width: 80,
        },
        {
            title: t.lineTotal,
            dataIndex: 'line_total',
            key: 'line_total',
            align: 'right',
            width: 100,
            render: (total) => <Text strong style={{color: '#52c41a'}}>{total} ₾</Text>,
        },
    ];

    return (
        <>
            {contextHolder}

            {/* Search / Filter Toolbar */}
            <Card size="small" style={{marginBottom: 16}}>
                <Flex align="center" gap={8} style={{marginBottom: 8}}>
                    <FilterOutlined style={{color: '#1677ff'}}/>
                    <Text strong>{t.searchOrders}</Text>
                </Flex>
                <Flex wrap="wrap" gap={12} align="end">
                    <Space direction="vertical" size={4} style={{minWidth: 120, flex: '1 1 120px', maxWidth: 200}}>
                        <Text type="secondary" style={{fontSize: 11}}>{t.orderStatus}</Text>
                        <Select
                            placeholder={t.allStatuses}
                            allowClear
                            value={statusFilter}
                            onChange={setStatusFilter}
                            style={{width: '100%'}}
                            options={[
                                {label: t.orderDraft, value: 'draft'},
                                {label: t.orderConfirmed, value: 'confirmed'},
                                {label: t.orderCancelled, value: 'cancelled'},
                            ]}
                        />
                    </Space>
                    <Space direction="vertical" size={4} style={{minWidth: 140, flex: '1 1 140px', maxWidth: 240}}>
                        <Text type="secondary" style={{fontSize: 11}}>{t.searchByCustomer}</Text>
                        <Input
                            placeholder={t.searchByCustomer}
                            value={customerSearch}
                            onChange={(e) => setCustomerSearch(e.target.value)}
                            style={{width: '100%'}}
                            prefix={<UserOutlined style={{opacity: 0.4}}/>}
                            allowClear
                            onPressEnter={handleSearch}
                        />
                    </Space>
                    <Space direction="vertical" size={4} style={{minWidth: 110, flex: '1 1 110px', maxWidth: 180}}>
                        <Text type="secondary" style={{fontSize: 11}}>{t.searchByOrderNumber}</Text>
                        <Input
                            placeholder={t.orderNumber}
                            value={orderNumberSearch}
                            onChange={(e) => setOrderNumberSearch(e.target.value)}
                            style={{width: '100%'}}
                            prefix={<ShoppingCartOutlined style={{opacity: 0.4}}/>}
                            allowClear
                            onPressEnter={handleSearch}
                        />
                    </Space>
                    <Space direction="vertical" size={4} style={{minWidth: 200, flex: '1 1 200px', maxWidth: 280}}>
                        <Text type="secondary" style={{fontSize: 11}}>{t.dateFrom} — {t.dateTo}</Text>
                        <RangePicker
                            value={dateRange}
                            onChange={setDateRange}
                            style={{width: '100%'}}
                        />
                    </Space>
                    <Flex gap={8} wrap="wrap">
                        <Button
                            type="primary"
                            icon={<SearchOutlined/>}
                            onClick={handleSearch}
                            loading={loading}
                        >
                            {t.search}
                        </Button>
                        <Button
                            icon={<ReloadOutlined/>}
                            onClick={() => {
                                setStatusFilter(null);
                                setCustomerSearch('');
                                setOrderNumberSearch('');
                                setDateRange(null);
                                // Fetch all after clearing
                                setTimeout(fetchOrders, 0);
                            }}
                        >
                            {t.clear}
                        </Button>
                    </Flex>
                </Flex>
            </Card>

            {/* Orders Table */}
            <Table
                dataSource={orders.map((o) => ({...o, key: o.id}))}
                columns={columns}
                loading={loading}
                size="middle"
                scroll={{x: 'max-content'}}
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

            {/* Order Detail Modal */}
            <Modal
                title={
                    <Flex align="center" gap={8}>
                        <ShoppingCartOutlined style={{fontSize: 18, color: '#1677ff'}}/>
                        <span style={{fontWeight: 600}}>
                            {t.orderDetails} {selectedOrder ? `#${selectedOrder.id}` : ''}
                        </span>
                        {selectedOrder && (
                            <Tag color={STATUS_COLOR_MAP[selectedOrder.status] || 'default'}>
                                {getStatusLabel(selectedOrder.status)}
                            </Tag>
                        )}
                    </Flex>
                }
                open={detailModalOpen}
                onCancel={() => {
                    setDetailModalOpen(false);
                    setSelectedOrder(null);
                }}
                footer={null}
                width={900}
                loading={detailLoading}
                styles={{body: {maxHeight: '75vh', overflowY: 'auto'}}}
            >
                {selectedOrder && (
                    <>
                        {/* Order Summary */}
                        <Descriptions
                            bordered
                            size="small"
                            column={{xs: 1, sm: 2}}
                            style={{marginBottom: 16}}
                        >
                            <Descriptions.Item label={t.customer}>
                                <Flex align="center" gap={6}>
                                    <UserOutlined style={{opacity: 0.4}}/>
                                    <Text strong>{displayCustomerName(selectedOrder, t)}</Text>
                                </Flex>
                            </Descriptions.Item>
                            <Descriptions.Item label={t.createdBy}>
                                {selectedOrder.created_by_username}
                            </Descriptions.Item>
                            <Descriptions.Item label={t.orderDate}>
                                <Flex align="center" gap={4}>
                                    <CalendarOutlined style={{opacity: 0.4}}/>
                                    {new Date(selectedOrder.created_at).toLocaleDateString()}{' '}
                                    {new Date(selectedOrder.created_at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                                </Flex>
                            </Descriptions.Item>
                            <Descriptions.Item label={t.orderTotal}>
                                <Title level={5} style={{margin: 0, color: '#52c41a'}}>
                                    {selectedOrder.total} ₾
                                </Title>
                            </Descriptions.Item>
                        </Descriptions>

                        {/* Delivery Info */}
                        <Card
                            size="small"
                            title={
                                <Flex align="center" gap={6}>
                                    {selectedOrder.delivery_type === 'delivery' ? <CarOutlined style={{color: '#1677ff'}}/> : <ShopOutlined style={{color: '#1677ff'}}/>}
                                    <Text strong>{t.deliveryInfo}</Text>
                                    <Tag color={selectedOrder.delivery_type === 'delivery' ? 'blue' : 'default'}>
                                        {getDeliveryLabel(selectedOrder.delivery_type)}
                                    </Tag>
                                </Flex>
                            }
                            style={{marginBottom: 16}}
                        >
                            {selectedOrder.delivery_type === 'delivery' ? (
                                <Descriptions size="small" column={1}>
                                    {selectedOrder.delivery_address && (
                                        <Descriptions.Item label={<><EnvironmentOutlined/> {t.deliveryAddress}</>}>
                                            {selectedOrder.delivery_address}
                                        </Descriptions.Item>
                                    )}
                                    {selectedOrder.delivery_date && (
                                        <Descriptions.Item label={<><CalendarOutlined/> {t.deliveryDate}</>}>
                                            {selectedOrder.delivery_date}
                                        </Descriptions.Item>
                                    )}
                                    {(selectedOrder.delivery_time_from || selectedOrder.delivery_time_to) && (
                                        <Descriptions.Item label={<><ClockCircleOutlined/> {t.deliveryTime}</>}>
                                            {selectedOrder.delivery_time_from || '—'} — {selectedOrder.delivery_time_to || '—'}
                                        </Descriptions.Item>
                                    )}
                                    {selectedOrder.delivery_notes && (
                                        <Descriptions.Item label={<><CommentOutlined/> {t.deliveryNotes}</>}>
                                            {selectedOrder.delivery_notes}
                                        </Descriptions.Item>
                                    )}
                                    {!selectedOrder.delivery_address && !selectedOrder.delivery_date && !selectedOrder.delivery_notes && (
                                        <Text type="secondary">{t.noDeliveryInfo}</Text>
                                    )}
                                </Descriptions>
                            ) : (
                                <Text type="secondary">{t.pickup}</Text>
                            )}
                        </Card>

                        {/* Notes */}
                        {selectedOrder.notes && (
                            <Card
                                size="small"
                                title={
                                    <Flex align="center" gap={6}>
                                        <CommentOutlined style={{color: '#1677ff'}}/>
                                        <Text strong>{t.orderNotes}</Text>
                                    </Flex>
                                }
                                style={{marginBottom: 16}}
                            >
                                <Text>{selectedOrder.notes}</Text>
                            </Card>
                        )}

                        {/* Items Table */}
                        <Divider style={{margin: '8px 0'}}/>
                        <Flex align="center" gap={8} style={{marginBottom: 8}}>
                            <ShoppingCartOutlined style={{color: '#1677ff'}}/>
                            <Text strong>{t.orderItems}</Text>
                            <Tag>{selectedOrder.items?.length || 0}</Tag>
                        </Flex>
                        <Table
                            dataSource={(selectedOrder.items || []).map((item) => ({...item, key: item.id}))}
                            columns={itemColumns}
                            size="small"
                            pagination={false}
                            scroll={{x: 'max-content'}}
                        />
                        <Flex justify="end" style={{padding: '12px 0'}}>
                            <Space size={8}>
                                <Text style={{fontSize: 16}}>{t.orderTotal}:</Text>
                                <Title level={4} style={{margin: 0, color: '#52c41a'}}>
                                    {selectedOrder.total} ₾
                                </Title>
                            </Space>
                        </Flex>
                    </>
                )}
            </Modal>
        </>
    );
};

export default OrdersTab;

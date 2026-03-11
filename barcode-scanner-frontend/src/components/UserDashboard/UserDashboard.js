import React, {useState, useEffect, useContext, useCallback, useRef} from 'react';
import {warehouseService, productService, orderService} from '../../api';
import BarcodeScanner from './BarcodeScanner';
import CustomerSelectModal from './CustomerSelectModal';
import OrderPanel from './OrderPanel';
import subNavContext from "../../contexts/SubNavContext";
import useAppNotification from "../../hooks/useAppNotification";
import {useLanguage} from '../../i18n/LanguageContext';
import {
    Button,
    Card,
    Carousel,
    Collapse,
    Drawer,
    Empty,
    Flex,
    Form,
    Input,
    List,
    Popconfirm,
    Result,
    Select,
    Spin,
    Switch,
    Table,
    Tag,
    Typography
} from "antd";
import {
    BarcodeOutlined,
    NumberOutlined,
    SearchOutlined,
    ShoppingOutlined,
    ShoppingCartOutlined,
    InboxOutlined,
    QrcodeOutlined,
    EditOutlined,
    PlusOutlined,
    PlusCircleOutlined,
    DeleteOutlined,
    UnorderedListOutlined,
    UserOutlined,
    CalendarOutlined,
    RightOutlined,
} from "@ant-design/icons";

const {Title, Text} = Typography;

const UserDashboard = () => {
    const [drawerVisible, setDrawerVisible] = useState(false);
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);
    const [disableScan, setDisableScan] = useState(false);
    const {setSubNav} = useContext(subNavContext);
    const [scannerOpen, setScannerOpen] = useState(false);
    const [balances, setBalances] = useState([]);
    const [userWarehouses, setUserWarehouses] = useState([]);
    const [productInfo, setProductInfo] = useState({sku_name: '', article: '', price: '', images: []});
    const {t} = useLanguage();

    // Purchase Order state
    const [orderMode, setOrderMode] = useState(false);
    const [activeOrder, setActiveOrder] = useState(null);
    const [customerModalOpen, setCustomerModalOpen] = useState(false);

    // Incomplete orders state
    const [incompleteOrders, setIncompleteOrders] = useState([]);
    const [incompleteOrdersLoading, setIncompleteOrdersLoading] = useState(false);
    const [showIncompleteOrders, setShowIncompleteOrders] = useState(false);

    const {notify, contextHolder} = useAppNotification();

    useEffect(() => {
        setSubNav(null);
        const fetchWarehouses = async () => {
            const result = await warehouseService.getWarehouses();
            if (result.success) {
                setUserWarehouses(result.data);
            } else {
                console.error("Failed to fetch user warehouses:", result.error);
            }
        };

        fetchWarehouses();
    }, [setSubNav]);

    // Fetch incomplete (draft) orders
    const fetchIncompleteOrders = useCallback(async () => {
        setIncompleteOrdersLoading(true);
        try {
            const result = await orderService.getOrders();
            if (result.success) {
                // Filter only draft orders, exclude the currently active order
                const drafts = (result.data || []).filter(
                    (o) => o.status === 'draft' && (!activeOrder || o.id !== activeOrder.id)
                );
                setIncompleteOrders(drafts);
            }
        } catch (err) {
            console.error("Failed to fetch orders:", err);
        } finally {
            setIncompleteOrdersLoading(false);
        }
    }, [activeOrder]);

    // Fetch incomplete orders when the section is opened or when active order changes
    useEffect(() => {
        if (showIncompleteOrders) {
            fetchIncompleteOrders();
        }
    }, [showIncompleteOrders, fetchIncompleteOrders]);

    // Guard against concurrent search calls
    const isSearchingRef = useRef(false);

    const handleSearch = useCallback(async ({search, searchType, allWarehouses}) => {
        // Prevent concurrent/duplicate calls
        if (isSearchingRef.current) return;
        isSearchingRef.current = true;
        setLoading(true);

        try {
            const warehouseCodes = allWarehouses
                ? []
                : userWarehouses.map(warehouse => warehouse.code);

            const result = await productService.searchProduct(search, searchType, warehouseCodes);

            if (result.success && result.data?.stock) {
                setBalances(result.data.stock);
                setProductInfo({
                    sku_name: result.data.sku_name,
                    article: result.data.article,
                    price: result.data.price,
                    sku: result.data.sku,
                    images: result.data.images || []
                });
                setDrawerVisible(false);
            } else {
                setBalances([]);
                setProductInfo({sku_name: '', article: '', price: '', images: []});

                if (!result.success) {
                    const errorMessages = {
                        'PRODUCT_NOT_FOUND': t.productNotFound,
                        'EXTERNAL_SERVICE_TIMEOUT': t.externalServiceTimeout,
                        'EXTERNAL_SERVICE_UNAVAILABLE': t.externalServiceUnavailable,
                        'EXTERNAL_SERVICE_ERROR': t.externalServiceError,
                        'EXTERNAL_SERVICE_UNAUTHORIZED': t.externalServiceUnauthorized,
                    };

                    const isExternalServiceError = result.code && result.code.startsWith('EXTERNAL_SERVICE_');
                    const title = isExternalServiceError ? t.webServiceError : t.error;
                    const errorMessage = errorMessages[result.code] || t.productSearchError;
                    notify.error(title, errorMessage);
                } else {
                    notify.warning(t.result, t.productNotFoundOrNoBalance);
                }
            }
        } finally {
            setLoading(false);
            isSearchingRef.current = false;
        }
    }, [userWarehouses, t, notify]);

    const handleScanResult = useCallback((decodedText) => {
        setScannerOpen(false);
        handleSearch({
            search: decodedText,
            searchType: 'barcode',
            allWarehouses: form.getFieldValue('allWarehouses')
        });
    }, [handleSearch, form]);

    const handleOpenScanner = () => {
        setDrawerVisible(false);
        setScannerOpen(true);
    };

    const handleOpenSearch = () => {
        setScannerOpen(false);
        setDrawerVisible(true);
    };

    // ===== Purchase Order handlers =====

    const handleStartOrderMode = () => {
        setCustomerModalOpen(true);
    };

    const handleCustomerSelected = async (customer) => {
        setCustomerModalOpen(false);
        // Create a new order with this customer
        const result = await orderService.createOrder({customer: customer.id});
        if (result.success) {
            setActiveOrder(result.data);
            setOrderMode(true);
            notify.success(t.success, t.orderCreated);
        } else {
            notify.error(t.orderError, result.error);
        }
    };

    const handleSaveForLater = () => {
        // Order is already saved as draft on the backend, just deactivate it locally
        notify.success(t.success, t.orderSavedForLater);
        setOrderMode(false);
        setActiveOrder(null);
        // Refresh incomplete orders if the section is open
        if (showIncompleteOrders) {
            fetchIncompleteOrders();
        }
    };

    const handleProceedToPayment = async () => {
        if (!activeOrder) return;
        // Confirm the order by changing its status to 'confirmed'
        const result = await orderService.updateOrder(activeOrder.id, {status: 'confirmed'});
        if (result.success) {
            notify.success(t.success, t.orderConfirmedSuccess);
            setOrderMode(false);
            setActiveOrder(null);
            // Refresh incomplete orders if the section is open
            if (showIncompleteOrders) {
                fetchIncompleteOrders();
            }
        } else {
            notify.error(t.orderError, result.error);
        }
    };

    const handleDeleteActiveOrder = async () => {
        if (!activeOrder) return;
        const result = await orderService.deleteOrder(activeOrder.id);
        if (result.success) {
            notify.success(t.success, t.orderDeleted);
            setOrderMode(false);
            setActiveOrder(null);
            if (showIncompleteOrders) {
                fetchIncompleteOrders();
            }
        } else {
            notify.error(t.orderError, result.error);
        }
    };

    const handleOrderUpdate = (updatedOrder) => {
        setActiveOrder(updatedOrder);
    };

    const handleContinueOrder = async (orderId) => {
        // Fetch the full order details and set it as active
        const result = await orderService.getOrder(orderId);
        if (result.success) {
            setActiveOrder(result.data);
            setOrderMode(true);
            setShowIncompleteOrders(false);
        } else {
            notify.error(t.orderError, result.error);
        }
    };

    const handleDeleteIncompleteOrder = async (e, orderId) => {
        // Stop propagation so the row click (continue) doesn't fire
        e.stopPropagation();
        const result = await orderService.deleteOrder(orderId);
        if (result.success) {
            notify.success(t.success, t.orderDeleted);
            // Remove from local state immediately
            setIncompleteOrders((prev) => prev.filter((o) => o.id !== orderId));
        } else {
            notify.error(t.orderError, result.error);
        }
    };

    const handleAddToOrderFromWarehouse = async (warehouseRecord) => {
        if (!activeOrder) return;
        const addResult = await orderService.addOrderItem(activeOrder.id, {
            sku: productInfo.sku,
            sku_name: productInfo.sku_name || '',
            article: productInfo.article || '',
            price: warehouseRecord.price || 0,
            quantity: 1,
            warehouse_code: warehouseRecord.warehouse || '',
            warehouse_name: warehouseRecord.warehouse_name || '',
        });
        if (addResult.success) {
            setActiveOrder(addResult.data);
            notify.success(t.success, t.productAddedToOrder);
        } else {
            notify.error(t.orderError, addResult.error);
        }
    };

    /**
     * Get the image source from Django's image response format.
     */
    const getImageSrc = (img) => {
        if (typeof img === 'string') return img;
        if (img.base64) return img.base64;
        if (img.original_url) return img.original_url;
        return '';
    };

    const hasResults = balances.length > 0;
    const showEmptyProductState = !hasResults && !scannerOpen;
    const showOrderPanel = orderMode && activeOrder;

    // ===== Left Panel: Order Section =====
    const renderOrderPanel = () => (
        <div className="dashboard-order-panel">
            {/* New Order Button */}
            {!showOrderPanel && (
                <Button
                    type="primary"
                    size="large"
                    icon={<PlusOutlined/>}
                    onClick={handleStartOrderMode}
                    block
                    style={{
                        borderRadius: 10,
                        height: 48,
                        fontWeight: 600,
                        marginBottom: 12,
                    }}
                >
                    {t.newOrder}
                </Button>
            )}

            {/* Active Order */}
            {showOrderPanel && (
                <OrderPanel
                    order={activeOrder}
                    onOrderUpdate={handleOrderUpdate}
                    onSaveForLater={handleSaveForLater}
                    onProceedToPayment={handleProceedToPayment}
                    onDeleteOrder={handleDeleteActiveOrder}
                    notify={notify}
                />
            )}

            {/* Incomplete Orders Section */}
            <Card
                size="small"
                style={{marginTop: showOrderPanel ? 12 : 0}}
                styles={{body: {padding: 0}}}
            >
                <Collapse
                    ghost
                    activeKey={showIncompleteOrders ? ['incomplete'] : []}
                    onChange={(keys) => setShowIncompleteOrders(keys.includes('incomplete'))}
                    expandIcon={({isActive}) => <RightOutlined rotate={isActive ? 90 : 0}/>}
                    items={[
                        {
                            key: 'incomplete',
                            label: (
                                <Flex align="center" gap={8}>
                                    <UnorderedListOutlined style={{color: '#faad14'}}/>
                                    <Text strong>{t.incompleteOrders}</Text>
                                    {incompleteOrders.length > 0 && (
                                        <Tag color="orange" style={{marginLeft: 4}}>
                                            {incompleteOrders.length}
                                        </Tag>
                                    )}
                                </Flex>
                            ),
                            children: (
                                <Spin spinning={incompleteOrdersLoading} size="small">
                                    {incompleteOrders.length === 0 ? (
                                        <Empty
                                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                                            description={
                                                <Text type="secondary" style={{fontSize: 13}}>
                                                    {t.noIncompleteOrders}
                                                </Text>
                                            }
                                            style={{margin: '12px 0'}}
                                        />
                                    ) : (
                                        <List
                                            size="small"
                                            dataSource={incompleteOrders}
                                            renderItem={(order) => (
                                                <List.Item
                                                    className="incomplete-order-row"
                                                    onClick={() => handleContinueOrder(order.id)}
                                                    style={{padding: '8px 8px', cursor: 'pointer', borderRadius: 8}}
                                                >
                                                    <List.Item.Meta
                                                        title={
                                                            <Flex align="center" gap={6}>
                                                                <Text strong style={{fontSize: 13}}>
                                                                    #{order.id}
                                                                </Text>
                                                                <Tag color="blue" style={{fontSize: 11}}>
                                                                    {t.orderDraft}
                                                                </Tag>
                                                            </Flex>
                                                        }
                                                        description={
                                                            <Flex vertical gap={2}>
                                                                <Flex align="center" gap={4}>
                                                                    <UserOutlined style={{fontSize: 11, opacity: 0.5}}/>
                                                                    <Text type="secondary" style={{fontSize: 12}}>
                                                                        {order.customer_name}
                                                                    </Text>
                                                                </Flex>
                                                                <Flex align="center" gap={4}>
                                                                    <CalendarOutlined style={{fontSize: 11, opacity: 0.5}}/>
                                                                    <Text type="secondary" style={{fontSize: 11}}>
                                                                        {new Date(order.created_at).toLocaleDateString()}
                                                                    </Text>
                                                                    {order.items_count > 0 && (
                                                                        <Tag style={{fontSize: 11, marginLeft: 4}}>
                                                                            {order.items_count} {t.items}
                                                                        </Tag>
                                                                    )}
                                                                </Flex>
                                                            </Flex>
                                                        }
                                                    />
                                                    <Flex align="center" gap={8}>
                                                        <Popconfirm
                                                            title={t.confirmDelete}
                                                            onConfirm={(e) => handleDeleteIncompleteOrder(e, order.id)}
                                                            onCancel={(e) => e.stopPropagation()}
                                                            okText={t.yes}
                                                            cancelText={t.no}
                                                        >
                                                            <Button
                                                                type="text"
                                                                danger
                                                                size="small"
                                                                icon={<DeleteOutlined/>}
                                                                onClick={(e) => e.stopPropagation()}
                                                            />
                                                        </Popconfirm>
                                                        <RightOutlined style={{fontSize: 12, opacity: 0.3}}/>
                                                    </Flex>
                                                </List.Item>
                                            )}
                                        />
                                    )}
                                </Spin>
                            ),
                        }
                    ]}
                />
            </Card>
        </div>
    );

    // ===== Right Panel: Product Search =====
    const renderProductPanel = () => (
        <div className="dashboard-product-panel">
            {/* Empty product state */}
            {showEmptyProductState && (
                <Result
                    icon={<ShoppingOutlined style={{color: '#1677ff', fontSize: 48}}/>}
                    title={<span style={{fontSize: 18, fontWeight: 600}}>{t.productSearch}</span>}
                    subTitle={
                        <span style={{fontSize: 13, opacity: 0.6}}>
                            {t.productSearchSubtitle}
                        </span>
                    }
                    extra={
                        <Flex gap={12} justify="center" wrap="wrap">
                            <Button
                                type="primary"
                                size="large"
                                icon={<QrcodeOutlined/>}
                                onClick={handleOpenScanner}
                                style={{borderRadius: 10, height: 48, paddingInline: 28, fontWeight: 600}}
                            >
                                {t.scan}
                            </Button>
                            <Button
                                size="large"
                                icon={<EditOutlined/>}
                                onClick={handleOpenSearch}
                                style={{borderRadius: 10, height: 48, paddingInline: 28}}
                            >
                                {t.manualSearch || t.search}
                            </Button>
                        </Flex>
                    }
                />
            )}

            {/* Product Results */}
            {!scannerOpen && hasResults && (
                <div style={{paddingBottom: 80}}>
                    {/* Product Info Card */}
                    <Card
                        className="product-result-card"
                        size="small"
                        style={{marginBottom: 16}}
                    >
                        <Flex align="center" gap={16} wrap="wrap">
                            {/* Product Images */}
                            {productInfo.images && productInfo.images.length > 0 && (
                                <div className="product-carousel">
                                    <Carousel
                                        arrows
                                        infinite
                                        autoplay
                                        autoplaySpeed={4000}
                                        style={{width: 200}}
                                    >
                                        {productInfo.images.map((img, index) => (
                                            <div key={index}>
                                                <img
                                                    src={getImageSrc(img)}
                                                    alt={`Product ${index + 1}`}
                                                    style={{
                                                        width: '100%',
                                                        maxHeight: 200,
                                                        objectFit: 'contain',
                                                        borderRadius: 8,
                                                    }}
                                                />
                                            </div>
                                        ))}
                                    </Carousel>
                                </div>
                            )}

                            {/* Product Details */}
                            <div style={{flex: 1, minWidth: 200}}>
                                <Title level={4} style={{margin: '0 0 4px 0'}}>
                                    {productInfo.sku_name}
                                </Title>
                                <Flex gap={8} wrap="wrap" style={{marginTop: 8}}>
                                    <Tag color="blue" style={{fontSize: 13, padding: '2px 10px'}}>
                                        {t.article}: {productInfo.article}
                                    </Tag>
                                    {productInfo.price && (
                                        <Tag color="green" style={{fontSize: 13, padding: '2px 10px'}}>
                                            {productInfo.price} ₾
                                        </Tag>
                                    )}
                                </Flex>
                            </div>
                        </Flex>
                    </Card>

                    {/* Balance Table */}
                    <Card
                        className="balance-table"
                        size="small"
                        title={
                            <Flex align="center" gap={8}>
                                <InboxOutlined style={{color: '#1677ff'}}/>
                                <span style={{fontWeight: 600}}>{t.balance}</span>
                                <Tag style={{marginLeft: 4}}>{balances.length}</Tag>
                            </Flex>
                        }
                    >
                        <Table
                            dataSource={balances.map((item, idx) => ({...item, key: idx}))}
                            rowClassName={(record) =>
                                userWarehouses.map(wh => wh.name).includes(record.warehouse_name) ? 'highlight-row' : ''
                            }
                            size="middle"
                            pagination={balances.length > 10 ? {pageSize: 10} : false}
                            columns={[
                                {
                                    title: t.warehouse,
                                    dataIndex: 'warehouse_name',
                                    key: 'warehouse_name',
                                    render: (name) => (
                                        <Text strong={userWarehouses.map(wh => wh.name).includes(name)}>
                                            {name}
                                        </Text>
                                    ),
                                },
                                {
                                    title: t.balance,
                                    dataIndex: 'quantity',
                                    key: 'quantity',
                                    align: 'right',
                                    render: (qty) => (
                                        <Tag color={qty > 0 ? 'green' : 'default'}
                                             style={{fontWeight: 600, fontSize: 13}}>
                                            {qty}
                                        </Tag>
                                    ),
                                },
                                {
                                    title: t.price,
                                    dataIndex: 'price',
                                    key: 'price',
                                    align: 'right',
                                    render: (price) => (
                                        <Text style={{fontWeight: 500}}>
                                            {price} ₾
                                        </Text>
                                    ),
                                },
                                // "Add to Order" column — only when there's an active order
                                ...(showOrderPanel ? [{
                                    title: '',
                                    key: 'add_to_order',
                                    width: 50,
                                    align: 'center',
                                    render: (_, record) => (
                                        <Button
                                            type="primary"
                                            size="small"
                                            icon={<PlusCircleOutlined/>}
                                            onClick={() => handleAddToOrderFromWarehouse(record)}
                                            disabled={record.quantity <= 0}
                                            title={t.addToOrder}
                                            style={{borderRadius: 6}}
                                        />
                                    ),
                                }] : []),
                            ]}
                        />
                    </Card>
                </div>
            )}
        </div>
    );

    return (
        <>
            {contextHolder}

            {/* Customer Selection Modal */}
            <CustomerSelectModal
                open={customerModalOpen}
                onSelect={handleCustomerSelected}
                onClose={() => setCustomerModalOpen(false)}
            />

            {/* Barcode Scanner (fullscreen overlay) */}
            <BarcodeScanner
                open={scannerOpen}
                onScan={handleScanResult}
                onClose={() => setScannerOpen(false)}
            />

            {/* Loading Overlay */}
            <Spin
                spinning={loading}
                tip={t.searchingProduct}
                style={{background: 'rgba(0, 0, 0, 0.05)', borderRadius: 12}}
                size="large"
            >
                {/* Search Drawer */}
                <Drawer
                    title={
                        <Flex align="center" gap={8}>
                            <SearchOutlined style={{fontSize: 18, color: '#1677ff'}}/>
                            <span style={{fontWeight: 600}}>{t.productSearch}</span>
                            {orderMode && (
                                <Tag color="blue" style={{marginLeft: 8}}>
                                    <ShoppingCartOutlined/> {t.orderMode}
                                </Tag>
                            )}
                        </Flex>
                    }
                    placement="bottom"
                    closable={true}
                    open={drawerVisible}
                    onClose={() => setDrawerVisible(false)}
                    className="search-drawer"
                    height="auto"
                    styles={{
                        body: {paddingTop: 16, paddingBottom: 24},
                    }}
                >
                    <Form
                        form={form}
                        onFinish={handleSearch}
                        initialValues={{searchType: 'barcode'}}
                        layout="vertical"
                        style={{maxWidth: 500, margin: '0 auto'}}
                    >
                        <Form.Item
                            name="searchType"
                            initialValue="barcode"
                            rules={[{required: true, message: t.selectSearchType}]}
                        >
                            <Select
                                size="large"
                                style={{borderRadius: 10}}
                                options={[
                                    {
                                        label: (
                                            <Flex align="center" gap={8}>
                                                <BarcodeOutlined/> {t.barcode}
                                            </Flex>
                                        ),
                                        value: "barcode"
                                    },
                                    {
                                        label: (
                                            <Flex align="center" gap={8}>
                                                <NumberOutlined/> {t.article}
                                            </Flex>
                                        ),
                                        value: "article"
                                    },
                                ]}
                                onChange={(value) => {
                                    if (value === 'barcode') {
                                        setDisableScan(false);
                                    } else {
                                        setDisableScan(true);
                                    }
                                }}
                            />
                        </Form.Item>

                        <Form.Item
                            name="search"
                            rules={[{required: true, message: t.enterSearchText}]}
                        >
                            <Input.Search
                                size="large"
                                placeholder={t.searchPlaceholder}
                                enterButton={
                                    <Button type="primary" icon={<SearchOutlined/>}>
                                        {t.search}
                                    </Button>
                                }
                                onSearch={form.submit}
                                allowClear
                                style={{borderRadius: 10}}
                            />
                        </Form.Item>

                        <Flex justify="center" style={{marginTop: 4}}>
                            <Form.Item
                                name="allWarehouses"
                                label={t.allWarehouses}
                                initialValue={false}
                                valuePropName="checked"
                            >
                                <Switch/>
                            </Form.Item>
                        </Flex>
                    </Form>

                    {/* Scan button inside drawer as alternative */}
                    {!disableScan && (
                        <Flex justify="center" style={{marginTop: 8}}>
                            <Button
                                type="default"
                                size="large"
                                icon={<QrcodeOutlined/>}
                                onClick={handleOpenScanner}
                                style={{borderRadius: 10, height: 44}}
                            >
                                {t.scanInstead || t.scan}
                            </Button>
                        </Flex>
                    )}
                </Drawer>
            </Spin>

            {/* ===== Two-Column Layout ===== */}
            <div className="dashboard-layout">
                {/* Left Column: Orders */}
                <div className="dashboard-left-col">
                    {renderOrderPanel()}
                </div>

                {/* Right Column: Product Search */}
                <div className="dashboard-right-col">
                    {renderProductPanel()}
                </div>
            </div>

            {/* ===== Floating Action Bar — always visible when not in scanner/drawer ===== */}
            {!scannerOpen && !drawerVisible && (
                <div className="floating-action-bar">
                    <Button
                        type="primary"
                        size="large"
                        icon={<QrcodeOutlined style={{fontSize: 20}}/>}
                        onClick={handleOpenScanner}
                        className="fab-scan-btn"
                    >
                        {hasResults ? (t.scanAgain || t.scan) : t.scan}
                    </Button>
                    <Button
                        size="large"
                        icon={<SearchOutlined style={{fontSize: 18}}/>}
                        onClick={handleOpenSearch}
                        className="fab-search-btn"
                    >
                        {t.search}
                    </Button>
                </div>
            )}
        </>
    );
};

export default UserDashboard;

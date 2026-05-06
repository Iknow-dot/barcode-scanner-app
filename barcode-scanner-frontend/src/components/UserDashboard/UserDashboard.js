import React, {useState, useEffect, useContext, useCallback, useRef} from 'react';
import {warehouseService, productService, orderService} from '../../api';
import BarcodeScanner from './BarcodeScanner';
import ClientLookupModal from './ClientLookupModal';
import OrderPanel from './OrderPanel';
import subNavContext from "../../contexts/SubNavContext";
import AuthContext from "../Auth/AuthContext";
import useAppNotification from "../../hooks/useAppNotification";
import {useLanguage} from '../../i18n/LanguageContext';
import {
    playFoundSound,
    playNotFoundSound,
    playOrderCreatedSound,
    playOrderResumedSound,
} from '../../utils/sound';
import {printInvoice} from '../../utils/printInvoice';
import {recordScan} from '../../utils/scanLog';
import useDailySnapshot from '../../hooks/useDailySnapshot';
import DailySnapshot from './DailySnapshot';
import groupItemsBySku from './groupItemsBySku';
import inheritFromGroup from './inheritFromGroup';
import {
    Badge,
    Button,
    Collapse,
    Drawer,
    Empty,
    Flex,
    Form,
    Input,
    List,
    Modal,
    Popconfirm,
    Result,
    Segmented,
    Spin,
    Switch,
    Tag,
    Typography,
    theme
} from "antd";
import {
    BarcodeOutlined,
    NumberOutlined,
    SearchOutlined,
    ShoppingOutlined,
    ShoppingCartOutlined,
    InboxOutlined,
    QrcodeOutlined,
    PlusOutlined,
    PlusCircleOutlined,
    PrinterOutlined,
    DeleteOutlined,
    UnorderedListOutlined,
    UserOutlined,
    CalendarOutlined,
    RightOutlined,
    AppstoreOutlined,
    CheckCircleFilled,
} from "@ant-design/icons";

const {Text} = Typography;

const ORDER_STATUS_COLOR = {
    draft: 'blue',
    confirmed: 'green',
    cancelled: 'red',
};

const LOW_STOCK_THRESHOLD = 5;
const MAX_STOCK_FOR_FULL_BAR = 15;

const UserDashboard = () => {
    const [drawerVisible, setDrawerVisible] = useState(false);
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);
    const [disableScan, setDisableScan] = useState(false);
    const {setSubNav} = useContext(subNavContext);
    const {authData} = useContext(AuthContext);
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

    // Customer search across all orders (any status) — used to find a past
    // order to reprint its invoice. Empty input keeps the tab in its
    // default "my drafts" view.
    const [customerSearch, setCustomerSearch] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);

    // Mobile tab state: 'scan' (product), 'current' (active order workflow),
    // or 'orders' (incomplete / draft orders).
    const [activeTab, setActiveTab] = useState('scan');

    // Order drawer for mobile (shows active order)
    const [orderDrawerVisible, setOrderDrawerVisible] = useState(false);
    const orderDrawerSwipeRef = useRef({startY: 0, fired: false});

    // Ref to track activeOrder without causing callback recreation
    const activeOrderRef = useRef(null);

    const {
        token: {colorBgContainer, colorBgBase, colorTextSecondary, colorBorderSecondary},
    } = theme.useToken();
    const isDarkMode = colorBgBase === "#000";

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

    // Scoped to current user; the customer-search effect below omits this filter on purpose so colleagues' drafts stay findable.
    const currentUserId = authData?.user?.id;
    const {
        scansSummary: snapshotScans,
        recentScans: snapshotRecent,
        ordersSummary: snapshotOrders,
        refresh: refreshSnapshot,
    } = useDailySnapshot(currentUserId);
    const fetchIncompleteOrders = useCallback(async () => {
        if (!currentUserId) return;
        setIncompleteOrdersLoading(true);
        try {
            const result = await orderService.getOrders({created_by: currentUserId});
            if (result.success) {
                const currentOrder = activeOrderRef.current;
                const drafts = (result.data || []).filter(
                    (o) => o.status === 'draft' && (!currentOrder || o.id !== currentOrder.id)
                );
                setIncompleteOrders(drafts);
            }
        } catch (err) {
            console.error("Failed to fetch orders:", err);
        } finally {
            setIncompleteOrdersLoading(false);
        }
    }, [currentUserId]);

    // Fetch incomplete drafts when switching to the Orders tab
    useEffect(() => {
        if (activeTab === 'orders') {
            fetchIncompleteOrders();
        }
    }, [activeTab, fetchIncompleteOrders]);

    // Debounced customer search across all org orders. Only runs while the
    // Orders tab is active and the input is non-empty.
    useEffect(() => {
        const trimmed = customerSearch.trim();
        if (activeTab !== 'orders' || !trimmed) {
            return;
        }
        const handle = setTimeout(async () => {
            setSearchLoading(true);
            try {
                const result = await orderService.getOrders({customer_search: trimmed});
                if (result.success) {
                    setSearchResults(Array.isArray(result.data) ? result.data : result.data?.results || []);
                } else {
                    setSearchResults([]);
                }
            } finally {
                setSearchLoading(false);
            }
        }, 300);
        return () => clearTimeout(handle);
    }, [activeTab, customerSearch]);

    const isSearchingRef = useRef(false);
    // Remembers the last successful search so the "show other warehouses"
    // button can re-run it with the warehouse filter dropped.
    const lastSearchRef = useRef(null);
    const [searchedAllWarehouses, setSearchedAllWarehouses] = useState(false);

    const handleSearch = useCallback(async ({search, searchType, allWarehouses}) => {
        if (isSearchingRef.current) return;
        isSearchingRef.current = true;
        setLoading(true);

        try {
            const warehouseCodes = allWarehouses
                ? []
                : userWarehouses.map(warehouse => warehouse.code);

            const result = await productService.searchProduct({
                sku: search,
                searchType,
                warehouseCodes,
            });

            if (result.success && result.data?.stock) {
                playFoundSound();
                setBalances(result.data.stock);
                recordScan({
                    search,
                    searchType,
                    found: true,
                    sku: result.data.sku,
                    sku_name: result.data.sku_name,
                    price: result.data.price,
                    total_qty: (result.data.stock || []).reduce(
                        (sum, b) => sum + (Number(b.quantity) || 0), 0,
                    ),
                });
                refreshSnapshot();
                setProductInfo({
                    sku_name: result.data.sku_name,
                    article: result.data.article,
                    price: result.data.price,
                    sku: result.data.sku,
                    images: result.data.images || []
                });
                lastSearchRef.current = {search, searchType};
                setSearchedAllWarehouses(!!allWarehouses);
                setDrawerVisible(false);
                // Switch to scan tab to show results
                setActiveTab('scan');
            } else {
                playNotFoundSound();
                setBalances([]);
                setProductInfo({sku_name: '', article: '', price: '', images: []});
                setSearchedAllWarehouses(false);

                const isExternalServiceError = result.code && result.code.startsWith('EXTERNAL_SERVICE_');

                if (!result.success) {
                    const errorMessages = {
                        'PRODUCT_NOT_FOUND': t.productNotFound,
                        'EXTERNAL_SERVICE_TIMEOUT': t.externalServiceTimeout,
                        'EXTERNAL_SERVICE_UNAVAILABLE': t.externalServiceUnavailable,
                        'EXTERNAL_SERVICE_ERROR': t.externalServiceError,
                        'EXTERNAL_SERVICE_UNAUTHORIZED': t.externalServiceUnauthorized,
                    };

                    const title = isExternalServiceError ? t.webServiceError : t.error;
                    const errorMessage = errorMessages[result.code] || t.productSearchError;
                    notify.error(title, errorMessage);
                } else {
                    notify.warning(t.result, t.productNotFoundOrNoBalance);
                }

                if (!isExternalServiceError) {
                    recordScan({
                        search,
                        searchType,
                        found: false,
                        sku: null,
                        sku_name: null,
                        price: null,
                        total_qty: null,
                    });
                    refreshSnapshot();
                }
            }
        } finally {
            setLoading(false);
            isSearchingRef.current = false;
        }
    }, [userWarehouses, t, notify, refreshSnapshot]);

    const handleScanResult = useCallback((decodedText) => {
        setScannerOpen(false);
        handleSearch({
            search: decodedText,
            searchType: 'barcode',
            allWarehouses: form.getFieldValue('allWarehouses')
        });
    }, [handleSearch, form]);

    const handleShowOtherWarehouses = useCallback(() => {
        if (!lastSearchRef.current) return;
        handleSearch({
            ...lastSearchRef.current,
            allWarehouses: true,
        });
    }, [handleSearch]);

    const handleResearchFromHistory = useCallback((entry) => {
        handleSearch({
            search: entry.search,
            searchType: entry.searchType,
            allWarehouses: form.getFieldValue('allWarehouses'),
        });
    }, [handleSearch, form]);

    const renderWarehouseRow = (item, isMine) => {
        const qty = Number(item.quantity) || 0;
        const isEmpty = qty === 0;
        const isLow = qty > 0 && qty <= LOW_STOCK_THRESHOLD;
        const fillPct = Math.min(100, (qty / MAX_STOCK_FOR_FULL_BAR) * 100);
        const qtyClass = isEmpty ? 'empty' : isLow ? 'low' : '';
        const fillClass = isEmpty ? 'empty' : isLow ? 'low' : '';

        return (
            <div
                key={`${item.warehouse}-${item.warehouse_name}`}
                className={`m-balance-card ${isMine ? 'm-balance-card-highlight' : ''}`}
            >
                <Flex justify="space-between" align="flex-start" gap={12}>
                    <div style={{flex: 1, minWidth: 0}}>
                        <Text
                            strong={isMine}
                            className="m-balance-warehouse"
                            ellipsis
                        >
                            {item.warehouse_name}
                        </Text>
                        <Text type="secondary" style={{fontSize: 12, display: 'block', marginTop: 2}}>
                            {item.price} ₾
                        </Text>
                    </div>
                    <Flex align="center" gap={8}>
                        <span className={`m-balance-qty-num ${qtyClass}`}>{qty}</span>
                        {showOrderPanel && (
                            <Button
                                type="primary"
                                size="middle"
                                icon={<PlusCircleOutlined/>}
                                onClick={(e) => handleAddToOrderFromWarehouse(item, e)}
                                disabled={qty <= 0}
                                className="m-add-to-order-btn"
                            />
                        )}
                    </Flex>
                </Flex>
                <div className="m-stock-meter">
                    <div
                        className={`fill ${fillClass}`}
                        style={isEmpty ? undefined : {width: `${fillPct}%`}}
                    />
                </div>
                {isLow && (
                    <div className="m-low-stock-label">{t.lowStock}</div>
                )}
            </div>
        );
    };

    const renderWarehouseSection = (items, isMine) => {
        if (items.length === 0) return null;
        return (
            <>
                <div className={`m-warehouse-section-header ${isMine ? 'mine' : ''}`}>
                    {isMine ? '⭐ ' : '🏬 '}
                    <Text strong style={{fontSize: 13, color: 'inherit'}}>
                        {isMine ? t.myWarehouses : t.otherWarehouses}
                    </Text>
                    <Tag style={{marginLeft: 4}}>{items.length}</Tag>
                </div>
                <div className="m-balance-list">
                    {items.map((item) => renderWarehouseRow(item, isMine))}
                </div>
            </>
        );
    };

    const handleOpenScanner = () => {
        setDrawerVisible(false);
        setScannerOpen(true);
    };

    const handleOpenSearch = () => {
        setScannerOpen(false);
        setDrawerVisible(true);
    };

    // ===== Purchase Order handlers =====

    // Save the in-progress order (already auto-saved on the backend) and start
    // a fresh one. Used by the "New Order" button on the Orders tab.
    const handleStartFreshOrder = () => {
        if (activeOrder) {
            handleSaveForLater();
        }
        setCustomerModalOpen(true);
    };

    const handleClientSelected = async (client) => {
        setCustomerModalOpen(false);
        const fullName = (client.name || '').trim()
            || [client.first_name, client.last_name].filter(Boolean).join(' ').trim();
        const payload = {
            customer_name: fullName || client.identification_number || client.phone || t.client,
            customer_phone: client.phone || '',
            customer_identification_number: client.identification_number || '',
            external_client_id: client.external_client_id || '',
            // Seed delivery_address from the client's address; remains
            // editable in the order's delivery panel for cases where the
            // order ships to a different location.
            delivery_address: client.address || '',
        };
        const result = await orderService.createOrder(payload);
        if (result.success) {
            activeOrderRef.current = result.data;
            setActiveOrder(result.data);
            setOrderMode(true);
            // Drop the user straight into the scan/product tab so they can
            // start adding items without an extra tap — mirrors the resume
            // flow in handleContinueOrder.
            setActiveTab('scan');
            // Backend returns 200 (instead of 201) when it resumed an existing
            // open draft for this client — surface that so the user knows
            // they're continuing rather than starting fresh.
            if (result.status === 200) {
                notify.info(t.activeOrder, t.orderResumedExisting);
                setIncompleteOrders((prev) => prev.filter((o) => o.id !== result.data.id));
                playOrderResumedSound();
            } else {
                playOrderCreatedSound();
            }
        } else {
            notify.error(t.orderError, result.error);
        }
    };

    const handleSaveForLater = () => {
        notify.success(t.success, t.orderSavedForLater);
        setOrderMode(false);
        activeOrderRef.current = null;
        setActiveOrder(null);
        setOrderDrawerVisible(false);
        fetchIncompleteOrders();
    };

    const handleProceedToPayment = async () => {
        if (!activeOrder) return;
        const orderId = activeOrder.id;
        const result = await orderService.updateOrder(orderId, {status: 'confirmed'});
        if (!result.success) {
            notify.error(t.orderError, result.error);
            return;
        }
        // Reset order panel state immediately — the modal lives on the
        // dashboard, not on the panel.
        setOrderMode(false);
        activeOrderRef.current = null;
        setActiveOrder(null);
        setOrderDrawerVisible(false);
        fetchIncompleteOrders();
        refreshSnapshot();
        Modal.confirm({
            title: t.orderConfirmedSuccess,
            content: t.orderConfirmedPrintPrompt(orderId),
            icon: <CheckCircleFilled style={{color: '#52c41a'}}/>,
            okText: t.printInvoice,
            cancelText: t.done,
            okType: 'primary',
            onOk: () => printInvoice(orderId, t, notify),
        });
    };

    const handleDeleteActiveOrder = async () => {
        if (!activeOrder) return;
        const result = await orderService.deleteOrder(activeOrder.id);
        if (result.success) {
            notify.success(t.success, t.orderDeleted);
            setOrderMode(false);
            activeOrderRef.current = null;
            setActiveOrder(null);
            setOrderDrawerVisible(false);
            fetchIncompleteOrders();
        } else {
            notify.error(t.orderError, result.error);
        }
    };

    // Called by OrderPanel when order details change (quantity, discount, delivery, etc.)
    // Only update the ref — do NOT call setActiveOrder here, as that would re-render
    // the parent and cause the Drawer to re-animate (slide down and back up).
    // The OrderPanel manages its own local state for display.
    const handleOrderUpdate = useCallback((updatedOrder) => {
        activeOrderRef.current = updatedOrder;
    }, []);

    const handleContinueOrder = async (orderId) => {
        const result = await orderService.getOrder(orderId);
        if (result.success) {
            activeOrderRef.current = result.data;
            setActiveOrder(result.data);
            setOrderMode(true);
            // Switch to scan tab so user can start scanning
            setActiveTab('scan');
            playOrderResumedSound();
        } else {
            notify.error(t.orderError, result.error);
        }
    };

    const handleDeleteIncompleteOrder = async (e, orderId) => {
        e.stopPropagation();
        const result = await orderService.deleteOrder(orderId);
        if (result.success) {
            notify.success(t.success, t.orderDeleted);
            setIncompleteOrders((prev) => prev.filter((o) => o.id !== orderId));
            setSearchResults((prev) => prev.filter((o) => o.id !== orderId));
        } else {
            notify.error(t.orderError, result.error);
        }
    };

    // Swipe-down-to-dismiss for the order drawer. Triggers only when the
    // content is already scrolled to the top, so vertical scrolling within
    // the drawer is unaffected.
    const SWIPE_CLOSE_THRESHOLD = 80;

    const closeOrderDrawer = useCallback(() => {
        setOrderDrawerVisible(false);
        if (activeOrderRef.current) {
            setActiveOrder(activeOrderRef.current);
        }
    }, []);

    const handleOrderDrawerTouchStart = (e) => {
        orderDrawerSwipeRef.current.startY = e.touches[0].clientY;
        orderDrawerSwipeRef.current.fired = false;
    };

    const handleOrderDrawerTouchMove = (e) => {
        if (orderDrawerSwipeRef.current.fired) return;
        const el = e.currentTarget;
        const deltaY = e.touches[0].clientY - orderDrawerSwipeRef.current.startY;
        if (el.scrollTop <= 0 && deltaY > SWIPE_CLOSE_THRESHOLD) {
            orderDrawerSwipeRef.current.fired = true;
            closeOrderDrawer();
        }
    };

    const animateAddToCart = (sourceEl) => {
        const cartEl = document.querySelector('.m-cart-fab');
        if (!cartEl || !sourceEl) return;
        const sourceRect = sourceEl.getBoundingClientRect();
        const cartRect = cartEl.getBoundingClientRect();

        const fly = document.createElement('div');
        fly.className = 'm-cart-fly';
        fly.style.left = `${sourceRect.left + sourceRect.width / 2 - 14}px`;
        fly.style.top = `${sourceRect.top + sourceRect.height / 2 - 14}px`;
        document.body.appendChild(fly);

        // Force reflow so the transition picks up the new transform.
        // eslint-disable-next-line no-unused-expressions
        fly.offsetHeight;

        const dx = (cartRect.left + cartRect.width / 2) - (sourceRect.left + sourceRect.width / 2);
        const dy = (cartRect.top + cartRect.height / 2) - (sourceRect.top + sourceRect.height / 2);
        fly.style.transform = `translate(${dx}px, ${dy}px) scale(0.25)`;
        fly.style.opacity = '0.4';

        window.setTimeout(() => {
            fly.remove();
            cartEl.classList.add('m-cart-pulse');
            window.setTimeout(() => cartEl.classList.remove('m-cart-pulse'), 460);
        }, 600);
    };

    const inheritFromExistingGroup = (sku) => {
        const order = activeOrderRef.current;
        if (!order || !Array.isArray(order.items)) return {};
        const group = groupItemsBySku(order.items).find((g) => g.sku === sku);
        return inheritFromGroup(group, !!authData?.user?.can_apply_discount);
    };

    const handleAddToOrderFromWarehouse = async (warehouseRecord, e) => {
        if (!activeOrder) return;
        if (e?.currentTarget) {
            animateAddToCart(e.currentTarget);
        }
        const inherited = inheritFromExistingGroup(productInfo.sku);
        const addResult = await orderService.addOrderItem(activeOrder.id, {
            sku: productInfo.sku,
            sku_name: productInfo.sku_name || '',
            article: productInfo.article || '',
            price: warehouseRecord.price || 0,
            quantity: 1,
            warehouse_code: warehouseRecord.warehouse || '',
            warehouse_name: warehouseRecord.warehouse_name || '',
            ...inherited,
        });
        if (addResult.success) {
            activeOrderRef.current = addResult.data;
            setActiveOrder(addResult.data);
        } else {
            notify.error(t.orderError, addResult.error);
        }
    };

    const getImageSrc = (img) => {
        if (typeof img === 'string') return img;
        if (img.base64) return img.base64;
        if (img.original_url) return img.original_url;
        return '';
    };

    const hasResults = balances.length > 0;
    const showEmptyProductState = !hasResults && !scannerOpen;
    const showOrderPanel = orderMode && activeOrder;

    // ===== Scan/Product Tab Content =====
    const renderScanTab = () => (
        <div className="m-tab-content">
            {/* Active order indicator bar */}
            {showOrderPanel && (
                <div
                    className="m-order-indicator"
                    onClick={() => setOrderDrawerVisible(true)}
                >
                    <Flex align="center" gap={8} style={{flex: 1, minWidth: 0}}>
                        <Badge count={activeOrder.items?.length || 0} size="small" overflowCount={99}>
                            <ShoppingCartOutlined style={{fontSize: 18, color: '#fff'}}/>
                        </Badge>
                        <Text className="m-order-indicator-text" ellipsis>
                            {t.activeOrder} #{activeOrder.id} · {activeOrder.customer_name}
                        </Text>
                    </Flex>
                    <Flex align="center" gap={4}>
                        <Text className="m-order-indicator-total">
                            {activeOrder.total} ₾
                        </Text>
                        <RightOutlined style={{color: '#fff', fontSize: 12}}/>
                    </Flex>
                </div>
            )}

            {/* Empty product state — daily snapshot */}
            {showEmptyProductState && (
                <DailySnapshot
                    username={authData?.user?.username}
                    scansSummary={snapshotScans}
                    recentScans={snapshotRecent}
                    ordersSummary={snapshotOrders}
                    onResearch={handleResearchFromHistory}
                />
            )}

            {/* Product Results */}
            {!scannerOpen && hasResults && (
                <Spin spinning={loading} tip={t.searchingProduct} size="large">
                    <div className="m-product-results">
                        {/* Product Hero */}
                        <div className="m-product-hero">
                            {productInfo.images && productInfo.images.length > 0 ? (
                                <img
                                    src={getImageSrc(productInfo.images[0])}
                                    alt={productInfo.sku_name || ''}
                                    className="m-product-hero-img"
                                />
                            ) : (
                                <div className="m-product-hero-img placeholder"/>
                            )}
                            <div className="m-product-hero-body">
                                <div style={{flex: 1, minWidth: 0}}>
                                    <div className="m-product-hero-title">
                                        {productInfo.sku_name}
                                    </div>
                                    <div className="m-product-hero-article">
                                        {t.article}: {productInfo.article}
                                    </div>
                                </div>
                                {productInfo.price && (
                                    <div className="m-product-hero-price">
                                        {productInfo.price} ₾
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Warehouse Sections */}
                        {(() => {
                            const userWarehouseNames = userWarehouses.map((w) => w.name);
                            const hasUserWarehouses = userWarehouseNames.length > 0;
                            if (!hasUserWarehouses) {
                                return (
                                    <div className="m-balance-section">
                                        <div className="m-balance-list">
                                            {balances.map((item) => renderWarehouseRow(item, false))}
                                        </div>
                                    </div>
                                );
                            }
                            const mine = balances.filter((b) => userWarehouseNames.includes(b.warehouse_name));
                            const others = balances.filter((b) => !userWarehouseNames.includes(b.warehouse_name));
                            return (
                                <div className="m-balance-section">
                                    {renderWarehouseSection(mine, true)}
                                    {renderWarehouseSection(others, false)}
                                </div>
                            );
                        })()}

                        {!searchedAllWarehouses && userWarehouses.length > 0 && lastSearchRef.current && (
                            <Button
                                type="default"
                                size="large"
                                icon={<AppstoreOutlined/>}
                                onClick={handleShowOtherWarehouses}
                                loading={loading}
                                block
                                className="m-show-other-warehouses-btn"
                            >
                                {t.seeAllWarehouses}
                            </Button>
                        )}
                    </div>
                </Spin>
            )}
        </div>
    );

    // ===== Orders Tab — incomplete drafts + customer search across all orders =====
    const renderOrderRow = (order) => {
        const isDraft = order.status === 'draft';
        const statusLabelMap = {
            draft: t.orderDraft,
            confirmed: t.orderConfirmed,
            cancelled: t.orderCancelled,
        };
        return (
            <List.Item
                className="m-incomplete-order-row"
                onClick={isDraft ? () => handleContinueOrder(order.id) : undefined}
                style={!isDraft ? {cursor: 'default'} : undefined}
            >
                <List.Item.Meta
                    title={
                        <Flex align="center" gap={6} wrap="wrap">
                            <Text strong style={{fontSize: 14}}>
                                #{order.id}
                            </Text>
                            <Tag color={ORDER_STATUS_COLOR[order.status] || 'default'} style={{fontSize: 11}}>
                                {statusLabelMap[order.status] || order.status}
                            </Tag>
                        </Flex>
                    }
                    description={
                        <Flex vertical gap={2}>
                            <Flex align="center" gap={4}>
                                <UserOutlined style={{fontSize: 11, opacity: 0.5}}/>
                                <Text type="secondary" style={{fontSize: 13}}>
                                    {order.customer_name}
                                </Text>
                            </Flex>
                            <Flex align="center" gap={4} wrap="wrap">
                                <CalendarOutlined style={{fontSize: 11, opacity: 0.5}}/>
                                <Text type="secondary" style={{fontSize: 12}}>
                                    {order.created_at && new Date(order.created_at).toLocaleDateString()}
                                </Text>
                                {order.items_count > 0 && (
                                    <Tag style={{fontSize: 11, marginLeft: 4}}>
                                        {order.items_count} {t.items}
                                    </Tag>
                                )}
                            </Flex>
                            {order.total != null && (
                                <Text strong style={{fontSize: 13, color: '#52c41a'}}>
                                    {t.orderTotal}: {order.total} ₾
                                </Text>
                            )}
                        </Flex>
                    }
                />
                <Flex align="center" gap={8}>
                    <Button
                        type="text"
                        size="small"
                        icon={<PrinterOutlined/>}
                        onClick={(e) => {
                            e.stopPropagation();
                            printInvoice(order.id, t, notify);
                        }}
                        title={t.printInvoice}
                    />
                    {isDraft && (
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
                    )}
                    {isDraft && <RightOutlined style={{fontSize: 12, opacity: 0.3}}/>}
                </Flex>
            </List.Item>
        );
    };

    const renderOrdersTab = () => {
        const isSearching = customerSearch.trim().length > 0;
        const displayedOrders = isSearching ? searchResults : incompleteOrders;
        const isLoading = isSearching ? searchLoading : incompleteOrdersLoading;
        const emptyText = isSearching ? t.noOrders : t.noIncompleteOrders;

        return (
            <div className="m-tab-content">
                <Button
                    type="primary"
                    size="large"
                    icon={<PlusOutlined/>}
                    onClick={handleStartFreshOrder}
                    block
                    className="m-new-order-btn"
                    style={{marginBottom: 12}}
                >
                    {t.newOrder}
                </Button>
                <Input
                    placeholder={t.searchByCustomer}
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    prefix={<UserOutlined style={{opacity: 0.4}}/>}
                    allowClear
                    style={{marginBottom: 12}}
                    size="large"
                />
                <Spin spinning={isLoading} size="large">
                    {displayedOrders.length === 0 && !isLoading ? (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description={
                                <Text type="secondary" style={{fontSize: 13}}>
                                    {emptyText}
                                </Text>
                            }
                            style={{margin: '32px 0'}}
                        />
                    ) : (
                        <List
                            size="small"
                            dataSource={displayedOrders}
                            renderItem={renderOrderRow}
                        />
                    )}
                </Spin>
            </div>
        );
    };

    return (
        <>
            {contextHolder}

            {/* Client Lookup Modal — CheckClient → CreateClient via 1C ConsultWebExchange */}
            <ClientLookupModal
                open={customerModalOpen}
                onSelect={handleClientSelected}
                onClose={() => setCustomerModalOpen(false)}
            />

            {/* Barcode Scanner (fullscreen overlay) */}
            <BarcodeScanner
                open={scannerOpen}
                onScan={handleScanResult}
                onClose={() => setScannerOpen(false)}
            />

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
                destroyOnHidden
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
                        <Segmented
                            size="large"
                            block
                            options={[
                                {
                                    label: (
                                        <Flex align="center" justify="center" gap={8}>
                                            <BarcodeOutlined/> {t.barcode}
                                        </Flex>
                                    ),
                                    value: "barcode"
                                },
                                {
                                    label: (
                                        <Flex align="center" justify="center" gap={8}>
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
                            autoFocus
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

            {/* Order Drawer (mobile - shows active order details) */}
            <Drawer
                title={
                    <Flex align="center" gap={8}>
                        <Badge count={activeOrder?.items?.length || 0} size="small" overflowCount={99}>
                            <ShoppingCartOutlined style={{fontSize: 18, color: '#1677ff'}}/>
                        </Badge>
                        <span style={{fontWeight: 600}}>{t.activeOrder} #{activeOrder?.id}</span>
                    </Flex>
                }
                placement="bottom"
                closable={true}
                open={orderDrawerVisible && showOrderPanel}
                onClose={closeOrderDrawer}
                height="85vh"
                className="m-order-drawer"
                destroyOnHidden
                styles={{
                    body: {padding: 0, overflow: 'hidden'},
                }}
            >
                {showOrderPanel && (
                    <div
                        onTouchStart={handleOrderDrawerTouchStart}
                        onTouchMove={handleOrderDrawerTouchMove}
                        style={{
                            height: '100%',
                            overflowY: 'auto',
                            overscrollBehaviorY: 'contain',
                            padding: '12px 16px 24px',
                        }}
                    >
                        <OrderPanel
                            order={activeOrder}
                            onOrderUpdate={handleOrderUpdate}
                            onSaveForLater={handleSaveForLater}
                            onProceedToPayment={handleProceedToPayment}
                            onDeleteOrder={handleDeleteActiveOrder}
                            notify={notify}
                            isMobileDrawer={true}
                        />
                    </div>
                )}
            </Drawer>

            {/* ===== Mobile-First Layout ===== */}
            <div className="m-dashboard">
                {/* Tab Content */}
                <div className="m-dashboard-body">
                    {activeTab === 'scan' && renderScanTab()}
                    {activeTab === 'orders' && renderOrdersTab()}
                </div>

                {/* Floating cart FAB — always available so the active order is
                    one tap away from any tab. */}
                {!scannerOpen && !drawerVisible && !orderDrawerVisible && !customerModalOpen && (
                    <button
                        type="button"
                        className={`m-cart-fab${showOrderPanel ? '' : ' m-cart-fab--inactive'}`}
                        aria-label={t.activeOrder}
                        onClick={() => {
                            if (activeOrder) {
                                setOrderDrawerVisible(true);
                            } else {
                                setCustomerModalOpen(true);
                            }
                        }}
                    >
                        <Badge
                            count={showOrderPanel ? (activeOrder?.items?.length || 0) : 0}
                            size="small"
                            offset={[2, -2]}
                            color="#ff4d4f"
                        >
                            <ShoppingCartOutlined style={{color: '#fff', fontSize: 24}}/>
                        </Badge>
                    </button>
                )}

                {/* ===== Bottom Navigation / Action Bar ===== */}
                {!scannerOpen && !drawerVisible && (
                    <div className="m-bottom-bar" style={{
                        background: isDarkMode ? 'rgba(20, 20, 20, 0.96)' : 'rgba(255, 255, 255, 0.96)',
                        borderTopColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
                    }}>
                        {/* Primary actions row — kept visible above the tab bar so
                            scan/search stay within thumb reach on mobile. */}
                        <div className="m-action-row">
                            <Button
                                type="primary"
                                size="large"
                                icon={<QrcodeOutlined style={{fontSize: 20}}/>}
                                onClick={handleOpenScanner}
                                className="m-fab-scan"
                            >
                                {hasResults ? (t.scanAgain || t.scan) : t.scan}
                            </Button>
                            <Button
                                size="large"
                                icon={<SearchOutlined style={{fontSize: 18}}/>}
                                onClick={handleOpenSearch}
                                className="m-fab-search"
                            >
                                {t.search}
                            </Button>
                        </div>

                        {/* Tab navigation row */}
                        <div className="m-tab-bar" style={{
                            borderTopColor: isDarkMode ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
                        }}>
                            <button
                                className={`m-tab-item ${activeTab === 'scan' ? 'm-tab-active' : ''}`}
                                onClick={() => setActiveTab('scan')}
                                style={activeTab !== 'scan' ? {color: isDarkMode ? 'rgba(255, 255, 255, 0.4)' : undefined} : undefined}
                            >
                                <AppstoreOutlined style={{fontSize: 20}}/>
                                <span>{t.product}</span>
                            </button>
                            <button
                                className={`m-tab-item ${activeTab === 'orders' ? 'm-tab-active' : ''}`}
                                onClick={() => setActiveTab('orders')}
                                style={activeTab !== 'orders' ? {color: isDarkMode ? 'rgba(255, 255, 255, 0.4)' : undefined} : undefined}
                            >
                                <UnorderedListOutlined style={{fontSize: 20}}/>
                                <span>{t.orders}</span>
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
};

export default UserDashboard;

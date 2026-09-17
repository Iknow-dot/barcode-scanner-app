import React, {useState, useEffect, useContext, useCallback, useMemo, useRef} from 'react';
import {warehouseService, productService, orderService, catalogService} from '../../api';
import BarcodeScanner from './BarcodeScanner';
import ClientLookupModal from './ClientLookupModal';
import OrderSheet from './OrderSheet';
import ProductSheet from './ProductSheet';
import EmptyCartSheet from './EmptyCartSheet';
import FindProductDrawer from './FindProductDrawer';
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
// Aliased: `handleSearch` below takes a `recordScan` boolean param (whether to
// count this lookup in the backend scan analytics) that would otherwise
// shadow this import for the whole function body.
import {recordScan as logScanHistory} from '../../utils/scanLog';
import useDailySnapshot from '../../hooks/useDailySnapshot';
import HomeView from './HomeView';
import TabBar from './TabBar';
import ActiveOrderBar, {ACTIVE_ORDER_ICON_SELECTOR} from './ActiveOrderBar';
import {nextTabAction} from './tabSelection';
import IosIcon from '../Common/IosIcon';
import groupItemsBySku from './groupItemsBySku';
import {hasProductResult} from './stockStatus';
import inheritFromGroup from './inheritFromGroup';
import formatInsufficientStock from './insufficientStock';
import formatConfirmError from './confirmError';
import activeOrderBarView from './activeOrderBarView';
import {pickUnit} from './warehouseRowView';
import {unitLabel} from './productSheetView';
import {ADD_FLOW_IDLE, lookupClosed, orderStartFailed, orderStarted, startAdd} from './addFlow';
import {catalogFeatureEnabled} from '../../utils/features';
import {orderStatusColor} from '../../utils/orderStatusColor';
import displayCustomerName from '../../utils/orderDisplay';
import OfflineBanner, {useOfflineStatus} from './OfflineBanner';
import {startSyncLoop} from '../../utils/offlineOrderSync';
import {
    enqueueOp,
    applyOpToSnapshot,
    getSnapshot,
    makeTempId,
    saveSnapshot,
    pendingCount,
    getQueuedOrderIds,
} from '../../utils/offlineOrderQueue';
import {isOffline} from '../../utils/connectivity';
import {
    Button,
    Collapse,
    Empty,
    Flex,
    Input,
    List,
    Modal,
    Popconfirm,
    Result,
    Spin,
    Tag,
    Typography,
    theme
} from "antd";
import {
    ShoppingOutlined,
    InboxOutlined,
    PrinterOutlined,
    DeleteOutlined,
    UserOutlined,
    CalendarOutlined,
    RightOutlined,
    CheckCircleFilled,
} from "@ant-design/icons";

const {Text} = Typography;

const UserDashboard = ({isDark = false, onToggleTheme}) => {
    const [drawerVisible, setDrawerVisible] = useState(false);
    const [loading, setLoading] = useState(false);
    const [allWarehouses, setAllWarehouses] = useState(false);
    const {setSubNav} = useContext(subNavContext);
    const {authData, logout} = useContext(AuthContext);
    // Catalog browse/search is an org-level feature; when it's off, the
    // search entry point and the find-product drawer are hidden entirely.
    const catalogEnabled = catalogFeatureEnabled(authData);
    const [scannerOpen, setScannerOpen] = useState(false);
    const [balances, setBalances] = useState([]);
    const [userWarehouses, setUserWarehouses] = useState([]);
    const [productInfo, setProductInfo] = useState({sku_name: '', article: '', price: '', images: []});
    // Set when a scan resolved the product but its balances can't be trusted —
    // either the live 1C lookup failed or the catalog row has no identifier 1C
    // can resolve (see stockStatus.js). We still show the product, just without
    // a balance list, instead of treating it as a not-found error.
    const [stockStatus, setStockStatus] = useState('');
    const {t} = useLanguage();

    // Purchase Order state
    const [orderMode, setOrderMode] = useState(false);
    const [activeOrder, setActiveOrder] = useState(null);
    const [customerModalOpen, setCustomerModalOpen] = useState(false);
    const [changeCustomerOpen, setChangeCustomerOpen] = useState(false);

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

    // Order sheet (the active order's cart and delivery steps)
    const [orderDrawerVisible, setOrderDrawerVisible] = useState(false);

    // Product sheet (opened by every successful lookup) and the empty cart
    // sheet (the idle active-order bar). addFlowRef holds a pick while the
    // new-order client lookup is open — see addFlow.js.
    const [productSheetOpen, setProductSheetOpen] = useState(false);
    const productSheetOpenRef = useRef(productSheetOpen);
    productSheetOpenRef.current = productSheetOpen;
    const [emptyCartOpen, setEmptyCartOpen] = useState(false);
    const [addingToOrder, setAddingToOrder] = useState(false);
    const addFlowRef = useRef(ADD_FLOW_IDLE);

    // Ref to track activeOrder without causing callback recreation
    const activeOrderRef = useRef(null);

    const {
        token: {colorBgContainer, colorTextSecondary, colorBorderSecondary},
    } = theme.useToken();

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

        // Restore-after-refresh: if there's no active order but a queued
        // offline order exists, restore it from its snapshot so pending
        // work stays visible instead of silently vanishing.
        const queued = getQueuedOrderIds();
        if (!activeOrderRef.current && queued.length > 0) {
            const snapshot = getSnapshot(queued[0]);
            if (snapshot) {
                activeOrderRef.current = snapshot;
                setActiveOrder(snapshot);
                setOrderMode(true);
            }
        }
    }, [setSubNav]);

    const userWarehousesRef = useRef(userWarehouses);
    userWarehousesRef.current = userWarehouses;
    // The product sheet matches "my warehouses" by name, as the result page did.
    const userWarehouseNames = useMemo(() => userWarehouses.map((w) => w.name), [userWarehouses]);

    useEffect(() => {
        const stop = startSyncLoop(() => ({
            userWarehouses: userWarehousesRef.current,
            onSynced: (orderId, result) => {
                if (result.aborted) return;
                if (result.failures.length > 0) {
                    notify.warning(t.orderError, t.offlineSyncFailures(result.failures.length));
                } else if (result.synced > 0) {
                    notify.success(t.success, t.offlineSynced);
                }
                // Refresh the active order view with the canonical server state.
                if (result.order && activeOrderRef.current?.id === result.order.id) {
                    activeOrderRef.current = result.order;
                    setActiveOrder(result.order);
                }
            },
        }));
        return stop;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
    // When true, the "Other warehouses" section is collapsed in the UI even
    // though the data exists in `balances`. Lets the user fetch-then-hide
    // without paying for another round-trip.
    const [othersCollapsed, setOthersCollapsed] = useState(true);

    const handleSearch = useCallback(async ({search, searchType, allWarehouses, fromScan, recordScan}) => {
        if (isOffline() && fromScan && activeOrderRef.current) {
            const orderId = activeOrderRef.current.id;
            const op = {type: 'add_item_barcode', tempId: makeTempId(), barcode: search, quantity: 1};
            enqueueOp(orderId, op);
            const snapshot = getSnapshot(orderId) || activeOrderRef.current;
            const optimistic = applyOpToSnapshot(snapshot, op);
            saveSnapshot(orderId, optimistic);
            activeOrderRef.current = optimistic;
            setActiveOrder(optimistic);
            playFoundSound();
            notify.info(t.activeOrder, t.offlineItemPending);
            return;
        }
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
                recordScan,
            });

            if (result.success && result.data?.stock) {
                playFoundSound();
                // Drop warehouses with a negative balance — they're an upstream
                // accounting artefact, not stock the user can actually sell.
                const visibleStock = (result.data.stock || []).filter(
                    (b) => (Number(b.quantity) || 0) >= 0
                );
                setBalances(visibleStock);
                // Live 1C stock lookup failed upstream — the product itself was
                // resolved (locally or via 1C), so still show it, just flag that
                // the balance list can't be trusted right now.
                setStockStatus(result.data.stock_status || '');
                logScanHistory({
                    search,
                    searchType,
                    found: true,
                    sku: result.data.sku,
                    sku_name: result.data.sku_name,
                    price: result.data.price,
                    total_qty: visibleStock.reduce(
                        (sum, b) => sum + (Number(b.quantity) || 0), 0,
                    ),
                });
                refreshSnapshot();
                setProductInfo({
                    sku_name: result.data.sku_name,
                    article: result.data.article,
                    price: result.data.price,
                    sku: result.data.sku,
                    // Per-lookup-key unit from 1C (a package barcode and the
                    // article can report different units for one product).
                    unit: result.data.unit || '',
                    images: result.data.images || [],
                    // Shown after the article on the product sheet.
                    barcode: searchType === 'barcode' ? search : '',
                });
                lastSearchRef.current = {search, searchType};
                setSearchedAllWarehouses(!!allWarehouses);
                setOthersCollapsed(!allWarehouses);
                setDrawerVisible(false);
                // Show the product sheet over Home on the scan tab.
                setActiveTab('scan');
                setProductSheetOpen(true);
            } else {
                playNotFoundSound();
                // A failed re-run (other warehouses) must not leave an empty
                // sheet open.
                setProductSheetOpen(false);
                setBalances([]);
                setProductInfo({sku_name: '', article: '', price: '', images: []});
                setSearchedAllWarehouses(false);
                setStockStatus('');

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
                    logScanHistory({
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
            allWarehouses,
            fromScan: true,
            recordScan: true,
        });
    }, [handleSearch, allWarehouses]);

    // A re-run of the lookup already counted — deliberately no recordScan.
    const handleShowOtherWarehouses = useCallback(() => {
        if (!lastSearchRef.current) return;
        handleSearch({
            ...lastSearchRef.current,
            allWarehouses: true,
        });
    }, [handleSearch]);

    // Selecting a product in the Find-product drawer (typeahead or category
    // browse) closes it and runs the same scan flow as an exact sku lookup.
    const handleSelectFromCatalog = useCallback((sku) => {
        setDrawerVisible(false);
        handleSearch({
            search: sku,
            searchType: 'article',
            allWarehouses,
            recordScan: true,
        });
    }, [handleSearch, allWarehouses]);

    const handleResearchFromHistory = useCallback((entry) => {
        handleSearch({
            search: entry.search,
            searchType: entry.searchType,
            allWarehouses,
            recordScan: true,
        });
    }, [handleSearch, allWarehouses]);

    // Clears the product result. Runs once the product sheet has finished
    // closing, and on the pop-to-Home tab re-tap.
    const handleBackToDashboard = useCallback(() => {
        setProductSheetOpen(false);
        setBalances([]);
        setProductInfo({sku_name: '', article: '', price: '', images: []});
        setSearchedAllWarehouses(false);
        setOthersCollapsed(true);
        setStockStatus('');
        lastSearchRef.current = null;
    }, []);

    const handleToggleOthers = useCallback(() => {
        // First time the user wants to see other warehouses — fetch them.
        // Subsequent toggles just flip visibility without another round-trip.
        if (othersCollapsed && !searchedAllWarehouses && lastSearchRef.current) {
            handleShowOtherWarehouses();
        } else {
            setOthersCollapsed((prev) => !prev);
        }
    }, [othersCollapsed, searchedAllWarehouses, handleShowOtherWarehouses]);

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

    const handleChangeCustomerSelected = async (client) => {
        setChangeCustomerOpen(false);
        if (!activeOrder) return;
        const fullName = (client.name || '').trim()
            || [client.first_name, client.last_name].filter(Boolean).join(' ').trim();
        const payload = {
            customer_name: fullName || client.identification_number || client.phone || t.client,
            customer_phone: client.phone || '',
            customer_identification_number: client.identification_number || '',
            external_client_id: client.external_client_id || '',
            // Attaching a client converts a retail order into a normal one.
            is_retail: false,
        };
        const result = await orderService.updateOrder(activeOrder.id, payload);
        if (result.success) {
            activeOrderRef.current = result.data;
            setActiveOrder(result.data);
            notify.success(t.success, t.customerChanged);
        } else {
            notify.error(t.orderError, result.error);
        }
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
            runPendingAdd(result.data);
        } else {
            addFlowRef.current = orderStartFailed().flow;
            notify.error(t.orderError, result.error);
        }
    };

    // Start an order with no client (retail). Mirrors handleClientSelected but
    // sends only is_retail; the backend always creates a fresh draft (no client
    // id to dedupe against), so there is no 200/resume branch.
    const handleStartRetailOrder = async () => {
        setCustomerModalOpen(false);
        const result = await orderService.createOrder({is_retail: true});
        if (result.success) {
            activeOrderRef.current = result.data;
            setActiveOrder(result.data);
            setOrderMode(true);
            setActiveTab('scan');
            playOrderCreatedSound();
            runPendingAdd(result.data);
        } else {
            addFlowRef.current = orderStartFailed().flow;
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
        if (isOffline() || pendingCount(orderId) > 0) {
            notify.warning(t.orderError, t.offlineConfirmBlocked);
            return;
        }
        const result = await orderService.updateOrder(orderId, {status: 'confirmed'});
        if (!result.success) {
            // The backend re-checks live 1C free stock on confirm and answers
            // INSUFFICIENT_STOCK with one entry per short line — show which
            // products fell short instead of the raw English detail.
            if (result.code === 'INSUFFICIENT_STOCK') {
                notify.error(
                    t.insufficientStockTitle,
                    <span style={{whiteSpace: 'pre-line'}}>
                        {formatInsufficientStock(result.data?.items, t)}
                    </span>,
                );
                return;
            }
            // CreateOrder-push guards (ORDER_CREATE_REJECTED, warehouse and
            // item-key checks) answer with coded 400s — show the localized
            // message instead of the raw English detail.
            const confirmError = formatConfirmError(result, t);
            if (confirmError) {
                notify.error(
                    confirmError.title,
                    <span style={{whiteSpace: 'pre-line'}}>
                        {confirmError.message}
                    </span>,
                );
            } else {
                notify.error(t.orderError, result.error);
            }
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
            icon: <CheckCircleFilled style={{color: 'var(--if-green-text)'}}/>,
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

    // Called by OrderSheet when order details change (quantity, discount, delivery, etc.)
    // Only update the ref — do NOT call setActiveOrder here, as that would re-render
    // the dashboard on every edit. The sheet keeps its own local copy for
    // display; closeOrderDrawer copies the ref back into state.
    const handleOrderUpdate = useCallback((updatedOrder) => {
        activeOrderRef.current = updatedOrder;
    }, []);

    const handleContinueOrder = async (orderId) => {
        const result = await orderService.getOrder(orderId);
        if (result.success) {
            activeOrderRef.current = result.data;
            setActiveOrder(result.data);
            setOrderMode(true);
            // Land on the scan tab and open the cart drawer so the user sees
            // what's already in the resumed order before scanning more.
            setActiveTab('scan');
            setOrderDrawerVisible(true);
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

    // Closing the order sheet (button, mask, Escape or the swipe-down that
    // IosSheet handles) publishes the sheet's edits to the active-order bar.
    const closeOrderDrawer = useCallback(() => {
        setOrderDrawerVisible(false);
        if (activeOrderRef.current) {
            setActiveOrder(activeOrderRef.current);
        }
    }, []);

    const animateAddToCart = (sourceEl) => {
        const cartEl = document.querySelector(ACTIVE_ORDER_ICON_SELECTOR);
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

    // Adds the product sheet's pick to `order`: the same request, offline
    // fallback and fly-to-cart animation as the old quantity sheet, then the
    // sheet closes so the next scan is one tap away. `order` is passed in
    // because right after the add flow creates an order, state lags behind.
    const addItemToOrder = async (order, {sourceEl, quantity, warehouse_code, warehouse_name, price}) => {
        setAddingToOrder(true);
        try {
            if (sourceEl) {
                animateAddToCart(sourceEl);
            }
            const inherited = inheritFromExistingGroup(productInfo.sku);
            const addResult = await orderService.addOrderItem(order.id, {
                sku: productInfo.sku,
                sku_name: productInfo.sku_name || '',
                article: productInfo.article || '',
                price: price || 0,
                quantity,
                warehouse_code: warehouse_code || '',
                warehouse_name: warehouse_name || '',
                unit: pickUnit(inherited.unit, productInfo.unit),
                ...inherited,
            });
            if (addResult.success) {
                activeOrderRef.current = addResult.data;
                setActiveOrder(addResult.data);
                setProductSheetOpen(false);
            } else {
                notify.error(t.orderError, addResult.error);
            }
        } finally {
            setAddingToOrder(false);
        }
    };

    // "Add to order" on the product sheet. Without an active order the pick
    // waits in addFlowRef while the new-order client lookup is open.
    const handleProductSheetAdd = (pick, sourceEl) => {
        const item = {...pick, sourceEl};
        const {flow, effect} = startAdd(addFlowRef.current, item, !!showOrderPanel);
        addFlowRef.current = flow;
        if (effect.type === 'add') {
            addItemToOrder(activeOrder, effect.item);
        } else {
            setCustomerModalOpen(true);
        }
    };

    // An order was just created or resumed from the lookup: add the pick
    // that was waiting for it, if any.
    const runPendingAdd = (order) => {
        const {flow, effect} = orderStarted(addFlowRef.current);
        addFlowRef.current = flow;
        if (effect) {
            addItemToOrder(order, effect.item);
        }
    };

    // Closing the new-order lookup without an order drops a waiting pick;
    // the product sheet stays open.
    const handleCloseClientLookup = () => {
        setCustomerModalOpen(false);
        addFlowRef.current = lookupClosed().flow;
    };

    // Scan/name-search responses now return `images`/`image` as proxy PATH
    // STRINGS (e.g. "catalog/products/S1/image/0/"), not base64 objects —
    // resolve them to an absolute URL via catalogService.imageUrl(). The
    // object-shape checks are a defensive fallback for any stale/cached
    // response shape so rendering never throws.
    const getImageSrc = (img) => {
        if (!img) return '';
        if (typeof img === 'string') return catalogService.imageUrl(img);
        if (img.base64) return img.base64;
        if (img.original_url) return img.original_url;
        return '';
    };

    const {offline: activeOrderOffline, pending: activeOrderPending} = useOfflineStatus(activeOrder?.id);

    // A resolved product is a result even with no stock anywhere — see
    // hasProductResult in stockStatus.js.
    const hasResults = hasProductResult(productInfo, balances);
    // Home stays under the sheets; only the full-screen scanner replaces it.
    const showHome = !scannerOpen;
    const showOrderPanel = orderMode && activeOrder;
    // Passing null unless order mode is on keeps the active-order bar idle for
    // a paused order — if a real pause feature ever keeps activeOrder set with
    // orderMode off, revisit: tapping the idle bar starts a NEW order.
    const orderBarView = activeOrderBarView(showOrderPanel ? activeOrder : null, t);

    // The active-order bar: with an order it opens the order drawer; idle, it
    // opens the empty cart sheet. (The Orders tab's "+" still starts an order
    // through the client lookup.)
    const handleOpenCart = () => {
        if (orderBarView.active) {
            setOrderDrawerVisible(true);
        } else {
            setEmptyCartOpen(true);
        }
    };

    const handleEmptyCartScan = () => {
        setEmptyCartOpen(false);
        handleOpenScanner();
    };

    const handleEmptyCartSearch = () => {
        setEmptyCartOpen(false);
        handleOpenSearch();
    };

    // Closing the product sheet clears the result once the sheet is gone —
    // unless a new lookup already reopened it during the close animation.
    const handleProductSheetAfterClose = () => {
        if (!productSheetOpenRef.current) {
            handleBackToDashboard();
        }
    };

    // TabBar onSelectTab: re-tapping the already-selected Products tab while a
    // product result is showing pops back to Home instead of doing nothing —
    // see tabSelection.js. Switching tabs otherwise behaves as before.
    const handleSelectTab = (key) => {
        const action = nextTabAction(activeTab, key, hasResults);
        if (action === 'pop-to-home') {
            handleBackToDashboard();
        } else if (action === 'switch') {
            setActiveTab(key);
        }
    };

    // ===== Scan/Product Tab Content =====
    // Home is the whole scan tab; the product result is a sheet over it. The
    // offline banner renders below Home's large header (HomeView's `banner`
    // slot).
    const offlineBanner = showOrderPanel ? <OfflineBanner orderId={activeOrder.id}/> : null;

    const renderScanTab = () => (
        <div className="m-tab-content">
            {/* Home — the scan tab; the product result is a sheet over it */}
            {showHome && (
                <HomeView
                    isDark={isDark}
                    username={authData?.user?.username}
                    organizationName={authData?.organization_name}
                    warehouseNames={Array.isArray(authData?.warehouses) ? authData.warehouses : []}
                    scansSummary={snapshotScans}
                    ordersSummary={snapshotOrders}
                    recentScans={snapshotRecent}
                    canSearchManually={catalogEnabled}
                    onScan={handleOpenScanner}
                    onManualSearch={handleOpenSearch}
                    onResearch={handleResearchFromHistory}
                    onToggleTheme={onToggleTheme}
                    onLogout={logout}
                    banner={offlineBanner}
                />
            )}
        </div>
    );

    // ===== Orders Tab — incomplete drafts + customer search across all orders =====
    const renderOrderRow = (order) => {
        const isDraft = order.status === 'draft';
        const statusLabelMap = {
            draft: t.orderDraft,
            confirmed: t.orderConfirmed,
            completed: t.orderCompleted,
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
                            <Tag color={orderStatusColor(order.status)} style={{fontSize: 11}}>
                                {statusLabelMap[order.status] || order.status}
                            </Tag>
                        </Flex>
                    }
                    description={
                        <Flex vertical gap={2}>
                            <Flex align="center" gap={4}>
                                <UserOutlined style={{fontSize: 11, opacity: 0.5}}/>
                                <Text type="secondary" style={{fontSize: 13}}>
                                    {displayCustomerName(order, t)}
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
                                <Text strong style={{fontSize: 13, color: 'var(--if-label)'}}>
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
                <div className="if-navbar is-end">
                    <button
                        type="button"
                        className="if-glass-btn is-prominent"
                        aria-label={t.newOrder}
                        onClick={handleStartFreshOrder}
                    >
                        <IosIcon name="plus" size={22} stroke={2.4}/>
                    </button>
                </div>
                <div className="if-large-header">
                    <h1 className="if-large-title">{t.orders}</h1>
                </div>
                <Input
                    placeholder={t.searchByCustomer}
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    prefix={<UserOutlined style={{opacity: 0.4}}/>}
                    allowClear
                    style={{marginBottom: 12}}
                    size="large"
                />
                <div className="m-orders-list">
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
            </div>
        );
    };

    return (
        <>
            {contextHolder}

            {/* Change-customer modal — reuses ClientLookupModal but PATCHes the
                active order's denormalized customer fields instead of creating
                a new order. */}
            <ClientLookupModal
                open={changeCustomerOpen}
                onSelect={handleChangeCustomerSelected}
                onClose={() => setChangeCustomerOpen(false)}
            />

            {/* Client Lookup Modal — CheckClient → CreateClient via 1C ConsultWebExchange */}
            <ClientLookupModal
                open={customerModalOpen}
                onSelect={handleClientSelected}
                onRetail={handleStartRetailOrder}
                onClose={handleCloseClientLookup}
            />

            {/* Barcode Scanner (fullscreen overlay) */}
            <BarcodeScanner
                open={scannerOpen}
                onScan={handleScanResult}
                onClose={() => setScannerOpen(false)}
            />

            {/* Unified Find-product drawer: smart search + category browse.
                Only mounted when the org has the catalog feature enabled. */}
            {catalogEnabled && (
                <FindProductDrawer
                    open={drawerVisible}
                    onClose={() => setDrawerVisible(false)}
                    onSelectProduct={handleSelectFromCatalog}
                    onScan={handleOpenScanner}
                    allWarehouses={allWarehouses}
                    onAllWarehousesChange={setAllWarehouses}
                    orderMode={!!showOrderPanel}
                />
            )}

            {/* Order sheet: the active order's cart (step 1) and delivery
                (step 2). The idle bar opens the empty cart sheet instead. */}
            {showOrderPanel && (
                <OrderSheet
                    open={orderDrawerVisible}
                    order={activeOrder}
                    onClose={closeOrderDrawer}
                    onOrderUpdate={handleOrderUpdate}
                    onSaveForLater={handleSaveForLater}
                    onProceedToPayment={handleProceedToPayment}
                    onDeleteOrder={handleDeleteActiveOrder}
                    onChangeCustomer={() => setChangeCustomerOpen(true)}
                    notify={notify}
                    confirmDisabled={activeOrderOffline || activeOrderPending > 0}
                />
            )}

            {/* Product sheet: every successful lookup (scan, catalog pick,
                recent-scan re-run) opens it over Home. Its data is cleared
                only once it has finished closing. */}
            <ProductSheet
                open={productSheetOpen}
                onClose={() => setProductSheetOpen(false)}
                afterClose={handleProductSheetAfterClose}
                product={productInfo}
                imageSrc={productInfo.images && productInfo.images.length > 0 ? getImageSrc(productInfo.images[0]) : ''}
                unitLabel={unitLabel(pickUnit(inheritFromExistingGroup(productInfo.sku)?.unit, productInfo.unit), t)}
                balances={balances}
                userWarehouseNames={userWarehouseNames}
                stockStatus={stockStatus}
                searchedAllWarehouses={searchedAllWarehouses}
                hasLastSearch={!!lastSearchRef.current}
                othersExpanded={!othersCollapsed}
                othersLoading={loading}
                onToggleOthers={handleToggleOthers}
                adding={addingToOrder}
                onAdd={handleProductSheetAdd}
            />

            {/* Empty cart: the idle active-order bar */}
            <EmptyCartSheet
                open={emptyCartOpen}
                onClose={() => setEmptyCartOpen(false)}
                canSearchManually={catalogEnabled}
                onScan={handleEmptyCartScan}
                onManualSearch={handleEmptyCartSearch}
            />

            {/* ===== Mobile-First Layout ===== */}
            <div className="m-dashboard">
                {/* Tab Content */}
                <div className="m-dashboard-body">
                    {activeTab === 'scan' && renderScanTab()}
                    {activeTab === 'orders' && renderOrdersTab()}
                </div>

                {/* ===== Floating glass bars: the active order above the tab bar.
                    Hidden while the scanner or the catalog drawer is open. ===== */}
                {!scannerOpen && !drawerVisible && (
                    <>
                        <div className="if-edge-bottom" aria-hidden="true"/>
                        <div className="if-bottom-stack">
                            <ActiveOrderBar view={orderBarView} onOpen={handleOpenCart}/>
                            <TabBar
                                activeTab={activeTab}
                                onSelectTab={handleSelectTab}
                                showSearch={catalogEnabled}
                                onSearch={handleOpenSearch}
                            />
                        </div>
                    </>
                )}
            </div>
        </>
    );
};

export default UserDashboard;

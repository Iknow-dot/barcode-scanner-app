import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import UserDashboard from './UserDashboard';
import AuthContext from '../Auth/AuthContext';
import SubNavContext from '../../contexts/SubNavContext';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';
import {
    assignOpIds, enqueueOp, getAttention, getAttentionOrderIds, getSnapshot, parkOp, saveSnapshot,
} from '../../utils/offlineOrderQueue';
import {markOffline, markOnline} from '../../utils/connectivity';

const en = translations.en;

// The API surface the dashboard and the components it always mounts reach
// for; none of it is under test here.
jest.mock('../../api', () => ({
    warehouseService: {getWarehouses: jest.fn()},
    productService: {searchProduct: jest.fn(), fetchStock: jest.fn()},
    orderService: {getOrders: jest.fn(), getOrder: jest.fn(), updateOrder: jest.fn(), deleteOrder: jest.fn()},
    catalogService: {imageUrl: jest.fn(() => ''), categoryTree: jest.fn()},
}));
// OrdersView reaches the order list through the services barrel itself.
jest.mock('../../api/services', () => jest.requireMock('../../api'));

// Keeps html5-qrcode out of jsdom.
jest.mock('./BarcodeScanner', () => function BarcodeScannerStub() {
    return null;
});

// ClientLookupSheet (always mounted, closed) pulls in AddressMapPicker →
// react-leaflet, an ESM-only package CRA's jest transform can't parse.
jest.mock('./AddressMapPicker', () => function AddressMapPickerStub() {
    return null;
});

// The drain is offlineOrderSync.test.js's subject; the loop's timer would
// otherwise keep running for the whole file.
jest.mock('../../utils/offlineOrderSync', () => ({
    startSyncLoop: () => () => {},
    requestSync: jest.fn(),
}));

// jsdom lacks these browser APIs that antd's Drawer/notification touch.
beforeAll(() => {
    window.matchMedia = window.matchMedia || ((query) => ({
        matches: false, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
    }));
    global.ResizeObserver = global.ResizeObserver || class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
    global.MessageChannel = global.MessageChannel || class {
        constructor() {
            this.port1 = {onmessage: null, close() {}};
            this.port2 = {postMessage: () => {}, close() {}};
        }
    };
});

const AUTH = {
    token: 'tok',
    role: 'company_user',
    organization_id: '1',
    organization_name: 'OrgA',
    warehouses: ['Vake'],
    user: {id: 7, username: 'consultant'},
    product_catalog_enabled: true,
};

const ORDER = {
    id: 42,
    status: 'draft',
    customer_name: 'Nino Beridze',
    total: '179.80',
    items: [{
        id: 11, sku: 'PAN', sku_name: 'Granite pan', article: 'MG-2814',
        warehouse_code: 'W1', warehouse_name: 'Vake', quantity: '2', price: '89.90',
        effective_price: '89.90', discount_percent: '0.00', line_total: '179.80',
        is_gift: false, unit: 'piece',
    }],
};

const renderDashboard = () => render(
    <SubNavContext.Provider value={{subNav: [], setSubNav: jest.fn()}}>
        <AuthContext.Provider value={{authData: AUTH, logout: jest.fn()}}>
            <LanguageProvider>
                <UserDashboard/>
            </LanguageProvider>
        </AuthContext.Provider>
    </SubNavContext.Provider>,
);

const mountDashboard = async () => {
    renderDashboard();
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
};

const resetApi = () => {
    const {warehouseService, orderService, catalogService, productService} = require('../../api');
    jest.clearAllMocks();
    warehouseService.getWarehouses.mockResolvedValue({success: true, data: []});
    orderService.getOrders.mockResolvedValue({success: true, data: []});
    orderService.getOrder.mockResolvedValue({success: true, status: 200, data: ORDER});
    orderService.deleteOrder.mockResolvedValue({success: true, status: 204, data: null});
    catalogService.categoryTree.mockResolvedValue({success: true, data: []});
    productService.fetchStock.mockResolvedValue({success: true, status: 200, data: {results: []}});
};

describe('UserDashboard with lines the offline sync could not replay', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('language', 'en');
        localStorage.setItem('user', JSON.stringify({id: 7}));
        resetApi();

        // What a reload finds after a drain parked a scan and emptied the
        // rest of the queue: a snapshot and one parked line, nothing queued.
        saveSnapshot(42, ORDER);
        enqueueOp(42, {type: 'add_item_barcode', tempId: 'tmp_a', barcode: '4870001', quantity: 2});
        const [{id}] = assignOpIds(42);
        parkOp(42, id, {reason: 'not_found', attempts: 1, detail: null, product: '4870001'});
    });

    afterEach(() => {
        localStorage.clear();
    });

    test('a reload brings the order back with the parked line on show', async () => {
        await mountDashboard();

        const [list] = screen.getAllByRole('region', {name: en.offlineAttentionTitle});
        const row = within(list).getByRole('listitem');
        expect(row).toHaveTextContent('4870001');
        expect(row).toHaveTextContent(en.offlineReasonNotFound);
        expect(within(row).getByRole('button', {name: `${en.offlineRetryNow}: 4870001`})).toBeInTheDocument();
        expect(within(row).getByRole('button', {name: `${en.offlineDiscard}: 4870001`})).toBeInTheDocument();
    });

    test('the order cannot be confirmed while a line waits on the consultant', async () => {
        await mountDashboard();

        fireEvent.click(screen.getByRole('button', {name: /Nino Beridze/}));
        fireEvent.click(await screen.findByRole('button', {name: en.nextStep}));

        expect(await screen.findByRole('button', {name: en.confirmOrder})).toBeDisabled();
    });

    test('deleting the order drops its parked lines, so a reload cannot bring it back', async () => {
        const {orderService} = require('../../api');
        await mountDashboard();

        fireEvent.click(screen.getByRole('button', {name: /Nino Beridze/}));
        fireEvent.click(await screen.findByRole('button', {name: en.moreActions}));
        fireEvent.click(await screen.findByRole('button', {name: en.deleteOrder}));

        await waitFor(() => expect(getAttentionOrderIds()).toEqual([]));
        expect(orderService.deleteOrder).toHaveBeenCalledWith(42);
        expect(getSnapshot(42)).toBeNull();
    });

    test('a reload does not bring back an order deleted elsewhere whose only unsynced lines are parked', async () => {
        // Nothing is left to replay, so the sync loop never probes this order
        // and never learns it is gone; the restore has to ask.
        const {orderService} = require('../../api');
        orderService.getOrder.mockResolvedValue({success: false, status: 404, error: 'Not found.', code: null});

        await mountDashboard();

        expect(orderService.getOrder).toHaveBeenCalledWith('42');
        expect(screen.queryByRole('region', {name: en.offlineAttentionTitle})).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: /Nino Beridze/})).not.toBeInTheDocument();
        expect(getAttention(42)).toEqual([]);
    });

    test('a restore whose read a write overlapped reads the order again before opening it', async () => {
        // A read the server made before a write to the order committed can be
        // answered after it (orderService.getOrder says `stale`): here, the
        // order deleted from the Orders tab meanwhile.
        const {orderService} = require('../../api');
        orderService.getOrder
            .mockResolvedValueOnce({success: true, status: 200, data: ORDER, stale: true})
            .mockResolvedValueOnce({success: false, status: 404, error: 'Not found.', code: null});

        await mountDashboard();

        await waitFor(() => expect(orderService.getOrder).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(getAttention(42)).toEqual([]));
        expect(screen.queryByRole('button', {name: /Nino Beridze/})).not.toBeInTheDocument();
    });
});

describe('UserDashboard, continuing an order whose read a write overlapped', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('language', 'en');
        localStorage.setItem('user', JSON.stringify({id: 7}));
        resetApi();
    });

    afterEach(() => {
        localStorage.clear();
    });

    test('reads it again, so the cart opens on the order as it now stands', async () => {
        // The drain replayed a queued line while the Continue read was out:
        // read before that line committed, it lacks the line, and the drain,
        // done by then, hands the order to nobody.
        const {orderService} = require('../../api');
        orderService.getOrders.mockResolvedValue({success: true, data: [ORDER]});
        const LANDED = {
            ...ORDER,
            total: '449.50',
            items: [{...ORDER.items[0], quantity: '5', line_total: '449.50'}],
        };
        orderService.getOrder
            .mockResolvedValueOnce({success: true, status: 200, data: ORDER, stale: true})
            .mockResolvedValueOnce({success: true, status: 200, data: LANDED});
        await mountDashboard();

        fireEvent.click(screen.getByRole('button', {name: en.orders}));
        fireEvent.click(await screen.findByRole('button', {name: `${en.continueOrder} Nino Beridze #42`}));

        const cart = await screen.findByRole('dialog', {name: en.cart});
        await waitFor(() => expect(within(cart).getByRole('textbox', {name: en.quantity})).toHaveValue('5'));
        expect(orderService.getOrder).toHaveBeenCalledTimes(2);
    });

    test('and when that second read fails, opens it from the first rather than not at all', async () => {
        const {orderService} = require('../../api');
        orderService.getOrders.mockResolvedValue({success: true, data: [ORDER]});
        orderService.getOrder
            .mockResolvedValueOnce({success: true, status: 200, data: ORDER, stale: true})
            .mockResolvedValueOnce({success: false, status: 502, error: 'Bad Gateway', code: null});
        await mountDashboard();

        fireEvent.click(screen.getByRole('button', {name: en.orders}));
        fireEvent.click(await screen.findByRole('button', {name: `${en.continueOrder} Nino Beridze #42`}));

        const cart = await screen.findByRole('dialog', {name: en.cart});
        await waitFor(() => expect(within(cart).getByRole('textbox', {name: en.quantity})).toHaveValue('2'));
        expect(orderService.getOrder).toHaveBeenCalledTimes(2);
        expect(screen.queryByText(en.orderError)).not.toBeInTheDocument();
    });

    test('but an order the second read finds gone is not opened', async () => {
        const {orderService} = require('../../api');
        orderService.getOrders.mockResolvedValue({success: true, data: [ORDER]});
        orderService.getOrder
            .mockResolvedValueOnce({success: true, status: 200, data: ORDER, stale: true})
            .mockResolvedValueOnce({success: false, status: 404, error: 'Not found.', code: null});
        await mountDashboard();

        fireEvent.click(screen.getByRole('button', {name: en.orders}));
        fireEvent.click(await screen.findByRole('button', {name: `${en.continueOrder} Nino Beridze #42`}));

        await waitFor(() => expect(orderService.getOrder).toHaveBeenCalledTimes(2));
        await act(async () => {
            await Promise.resolve();
        });
        expect(screen.queryByRole('dialog', {name: en.cart})).not.toBeInTheDocument();
    });
});

// A line can park with the order never read back: the drain could not read it
// at all, or its closing read failed. The cart then still shows what the
// parked change made of the order, and once Discard drops the line nothing
// else would read it again: Confirm would come back over a cart showing a
// change that is not on the order.
describe('UserDashboard, discarding a line parked before the order was read back', () => {
    const SHOWN = {
        ...ORDER,
        total: '449.50',
        items: [{...ORDER.items[0], quantity: '5', line_total: '449.50', _pending: true}],
        _offline: true,
    };
    const UNREADABLE = {success: false, status: 500, error: 'Server error', code: null};
    const discardButton = (scope) => within(scope).getByRole('button', {name: `${en.offlineDiscard}: Granite pan`});
    const barSubtitle = (total) => `${en.activeOrder} · ${total} ₾`;

    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('language', 'en');
        localStorage.setItem('user', JSON.stringify({id: 7}));
        resetApi();
        saveSnapshot(42, SHOWN);
        enqueueOp(42, {type: 'update_item', itemId: 11, payload: {quantity: 5}});
        const [{id}] = assignOpIds(42);
        parkOp(42, id, {reason: 'rejected', attempts: 1, detail: 'Not enough stock', product: 'Granite pan'});
        // The reload could not read it either, so the order comes back from
        // its snapshot, the parked change still on it.
        const {orderService} = require('../../api');
        orderService.getOrder.mockResolvedValueOnce(UNREADABLE);
    });

    afterEach(() => {
        localStorage.clear();
    });

    const openCart = async () => {
        fireEvent.click(screen.getByRole('button', {name: /Nino Beridze/}));
        return screen.findByRole('dialog', {name: en.cart});
    };

    test('from the open cart, the cart and the dashboard show the order as the server has it', async () => {
        const {orderService} = require('../../api');
        await mountDashboard();
        const cart = await openCart();
        expect(within(cart).getByRole('textbox', {name: en.quantity})).toHaveValue('5');

        fireEvent.click(discardButton(cart));

        await waitFor(() => expect(within(cart).getByRole('textbox', {name: en.quantity})).toHaveValue('2'));
        expect(orderService.getOrder).toHaveBeenLastCalledWith(42);
        expect(screen.getByText(barSubtitle('179.80'))).toBeInTheDocument();
        expect(within(cart).queryByRole('region', {name: en.offlineAttentionTitle})).not.toBeInTheDocument();
    });

    test('from the Home banner too, so the cart opens on the server order', async () => {
        await mountDashboard();
        expect(screen.getByText(barSubtitle('449.50'))).toBeInTheDocument();
        const [home] = screen.getAllByRole('region', {name: en.offlineAttentionTitle});

        fireEvent.click(discardButton(home));

        expect(await screen.findByText(barSubtitle('179.80'))).toBeInTheDocument();
        const cart = await openCart();
        expect(within(cart).getByRole('textbox', {name: en.quantity})).toHaveValue('2');
    });

    test('a read that fails leaves the cart as it is, and says nothing more', async () => {
        // The banner has already said what happened to the line.
        const {orderService} = require('../../api');
        orderService.getOrder.mockResolvedValue(UNREADABLE);
        await mountDashboard();
        const cart = await openCart();

        fireEvent.click(discardButton(cart));
        await waitFor(() => expect(orderService.getOrder).toHaveBeenCalledTimes(2));
        await act(async () => {
            await Promise.resolve();
        });

        expect(within(cart).getByRole('textbox', {name: en.quantity})).toHaveValue('5');
        expect(screen.getByText(barSubtitle('449.50'))).toBeInTheDocument();
        expect(screen.queryByText(en.orderError)).not.toBeInTheDocument();
    });

    // Left at that, the cart would show the discarded change for good: with
    // nothing queued, no drain ever reads the order again, and once back
    // online Confirm is enabled over a cart the server does not hold.
    test('a read that got no answer is made again once the app is back online', async () => {
        const {orderService} = require('../../api');
        orderService.getOrder.mockResolvedValue({success: false, status: null, error: 'Network Error', code: null});
        await mountDashboard();
        const cart = await openCart();

        fireEvent.click(discardButton(cart));
        await waitFor(() => expect(orderService.getOrder).toHaveBeenCalledTimes(2));
        act(() => {
            markOffline(); // what the request layer does on a request with no answer
        });
        orderService.getOrder.mockResolvedValue({success: true, status: 200, data: ORDER});

        act(() => {
            markOnline();
        });

        await waitFor(() => expect(within(cart).getByRole('textbox', {name: en.quantity})).toHaveValue('2'));
        expect(screen.getByText(barSubtitle('179.80'))).toBeInTheDocument();
        expect(orderService.getOrder).toHaveBeenCalledTimes(3);
    });

    test('and one the server failed is made again on the next tick, until one is answered', async () => {
        // A 5xx leaves the app online: no reconnect is coming to retry it.
        jest.useFakeTimers();
        try {
            const {orderService} = require('../../api');
            orderService.getOrder.mockResolvedValue(UNREADABLE);
            await mountDashboard();
            const cart = await openCart();

            fireEvent.click(discardButton(cart));
            await waitFor(() => expect(orderService.getOrder).toHaveBeenCalledTimes(2));
            await act(async () => {
                jest.advanceTimersByTime(10000);
            });
            await waitFor(() => expect(orderService.getOrder).toHaveBeenCalledTimes(3));
            expect(within(cart).getByRole('textbox', {name: en.quantity})).toHaveValue('5');

            orderService.getOrder.mockResolvedValue({success: true, status: 200, data: ORDER});
            await act(async () => {
                jest.advanceTimersByTime(10000);
            });

            await waitFor(() => expect(within(cart).getByRole('textbox', {name: en.quantity})).toHaveValue('2'));
            await act(async () => {
                jest.advanceTimersByTime(30000);
            });
            expect(orderService.getOrder).toHaveBeenCalledTimes(4); // answered: no more reads
        } finally {
            jest.useRealTimers();
        }
    });

    test('a read a write overlapped is not taken: that write\'s own answer is newer', async () => {
        const {orderService} = require('../../api');
        orderService.getOrder.mockResolvedValue({success: true, status: 200, data: ORDER, stale: true});
        await mountDashboard();
        const cart = await openCart();

        fireEvent.click(discardButton(cart));
        await waitFor(() => expect(orderService.getOrder).toHaveBeenCalledTimes(2));
        await act(async () => {
            await Promise.resolve();
        });

        expect(within(cart).getByRole('textbox', {name: en.quantity})).toHaveValue('5');
        expect(screen.getByText(barSubtitle('449.50'))).toBeInTheDocument();
    });

    test('but it is still owed, and made again on the next tick', async () => {
        // The overlapping write may be a drain replay: its answer never reaches
        // the cart itself, and the drain's own closing read can fail.
        jest.useFakeTimers();
        try {
            const {orderService} = require('../../api');
            orderService.getOrder.mockResolvedValue({success: true, status: 200, data: ORDER, stale: true});
            await mountDashboard();
            const cart = await openCart();

            fireEvent.click(discardButton(cart));
            await waitFor(() => expect(orderService.getOrder).toHaveBeenCalledTimes(2));
            orderService.getOrder.mockResolvedValue({success: true, status: 200, data: ORDER});
            await act(async () => {
                jest.advanceTimersByTime(10000);
            });

            await waitFor(() => expect(within(cart).getByRole('textbox', {name: en.quantity})).toHaveValue('2'));
            expect(orderService.getOrder).toHaveBeenCalledTimes(3);
        } finally {
            jest.useRealTimers();
        }
    });
});

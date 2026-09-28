import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import UserDashboard from './UserDashboard';
import AuthContext from '../Auth/AuthContext';
import SubNavContext from '../../contexts/SubNavContext';
import {LanguageProvider, useLanguage} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';
import api from '../../api/request';
import {enqueueOp, getSnapshot, saveSnapshot} from '../../utils/offlineOrderQueue';
import {requestSync} from '../../utils/offlineOrderSync';
import {markOnline} from '../../utils/connectivity';

// The dashboard, the open cart, the order service, the queue and the sync
// loop are all real here; only the HTTP layer under them is a fake server
// (below). UserDashboard.offline.test.js stubs the drain out instead.
jest.mock('../../api/request', () => ({
    __esModule: true,
    default: {get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn()},
}));

// Keeps html5-qrcode out of jsdom.
jest.mock('./BarcodeScanner', () => function BarcodeScannerStub() {
    return null;
});

// ClientLookupSheet (always mounted, closed) pulls in AddressMapPicker →
// react-leaflet, an ESM-only package CRA's jest transform can't parse.
jest.mock('./AddressMapPicker', () => function AddressMapPickerStub() {
    return null;
});

const en = translations.en;

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

const PRICE = 89.9;

const withQuantity = (order, quantity) => {
    const total = (PRICE * quantity).toFixed(2);
    return {...order, total, items: [{...order.items[0], quantity: String(quantity), line_total: total}]};
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

const ok = (data) => ({success: true, status: 200, data});

// Order 42 as core/views/orders.py serves it: an order PATCH merges its
// fields, a line PATCH sets the line, and each answers with the whole order.
// A GET reads the order when it arrives; with `holdReads` its answer waits
// for releaseRead(), so a write can commit between the read and its answer.
const fakeServer = () => {
    const server = {order: ORDER, holdReads: false, heldReads: [], orderReads: 0};
    server.releaseRead = () => server.heldReads.shift()();
    api.get.mockImplementation((url) => {
        if (url !== 'api/v1/orders/42/') return Promise.resolve(ok([]));
        server.orderReads += 1;
        const read = ok(server.order);
        if (!server.holdReads) return Promise.resolve(read);
        return new Promise((resolve) => server.heldReads.push(() => resolve(read)));
    });
    api.patch.mockImplementation(async (url, data) => {
        if (url === 'api/v1/orders/42/') {
            server.order = {...server.order, ...data};
        } else if (url === 'api/v1/orders/42/items/11/update/') {
            server.order = withQuantity(server.order, Number(data.quantity));
        } else {
            return {success: false, status: 404, error: 'Not found.', code: null};
        }
        return ok(server.order);
    });
    // The cart's stock captions stay pending: not under test here.
    api.post.mockImplementation(() => new Promise(() => {}));
    return server;
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

const barSubtitle = (total) => `${en.activeOrder} · ${total} ₾`;

describe('UserDashboard, while the offline drain reads the order back', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        localStorage.setItem('language', 'en');
        localStorage.setItem('user', JSON.stringify({id: 7}));
        markOnline();
        // A reload with one order edit still queued: the dashboard reopens
        // the order from its snapshot, and the drain has it to replay.
        saveSnapshot(42, ORDER);
        enqueueOp(42, {type: 'update_order', payload: {notes: 'Call first'}});
    });

    afterEach(() => {
        localStorage.clear();
    });

    test('a quantity changed in the open cart is not undone by a read made before it committed', async () => {
        const server = fakeServer();
        renderDashboard();
        fireEvent.click(await screen.findByRole('button', {name: /Nino Beridze/}));
        const cart = await screen.findByRole('dialog', {name: en.cart});
        const quantity = within(cart).getByRole('textbox', {name: en.quantity});
        expect(quantity).toHaveValue('2');

        act(() => {
            requestSync(); // its opening read goes out at once, and is answered
        });
        server.holdReads = true;
        await waitFor(() => expect(server.orderReads).toBe(2)); // the notes replayed; the refetch is out

        fireEvent.click(within(cart).getByRole('button', {name: en.increaseQuantity}));
        await waitFor(() => expect(quantity).toHaveValue('3'));

        server.holdReads = false;
        await act(async () => {
            server.releaseRead(); // notes, but quantity 2: read before the edit
        });
        expect(await screen.findByText(en.offlineSynced)).toBeInTheDocument();

        expect(within(cart).getByRole('textbox', {name: en.quantity})).toHaveValue('3');
        expect(getSnapshot(42)).toMatchObject({notes: 'Call first', total: '269.70'});
        expect(getSnapshot(42).items[0].quantity).toBe('3');
        // The order bar shows the dashboard's own state, which the sheet's
        // edits never touch: only the drain's order reaches it.
        expect(screen.getByText(barSubtitle('269.70'))).toBeInTheDocument();
    });

    test('its toast is in the language picked after the dashboard mounted', async () => {
        // The loop starts once, on mount; the toast must not keep that
        // moment's language when the banner beside it follows the switch.
        localStorage.setItem('language', 'ka');
        fakeServer();
        const SwitchToEnglish = () => {
            const {switchLanguage} = useLanguage();
            return <button type="button" onClick={() => switchLanguage('en')}>English</button>;
        };
        render(
            <SubNavContext.Provider value={{subNav: [], setSubNav: jest.fn()}}>
                <AuthContext.Provider value={{authData: AUTH, logout: jest.fn()}}>
                    <LanguageProvider>
                        <SwitchToEnglish/>
                        <UserDashboard/>
                    </LanguageProvider>
                </AuthContext.Provider>
            </SubNavContext.Provider>,
        );
        await screen.findByRole('button', {name: /Nino Beridze/});
        fireEvent.click(screen.getByRole('button', {name: 'English'}));

        act(() => {
            requestSync();
        });

        expect(await screen.findByText(en.offlineSynced)).toBeInTheDocument();
        expect(screen.queryByText(translations.ka.offlineSynced)).not.toBeInTheDocument();
    });
});

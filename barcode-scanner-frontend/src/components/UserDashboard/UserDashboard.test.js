import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import UserDashboard from './UserDashboard';
import AuthContext from '../Auth/AuthContext';
import SubNavContext from '../../contexts/SubNavContext';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';
import {productService} from '../../api';
import {getTodayScans} from '../../utils/scanLog';

const en = translations.en;

// The whole API surface the dashboard and the components it always mounts
// reach for. `productService` is the one under test; the rest only has to
// resolve so mounting settles.
jest.mock('../../api', () => ({
    warehouseService: {getWarehouses: jest.fn()},
    productService: {searchProduct: jest.fn(), fetchStock: jest.fn()},
    orderService: {getOrders: jest.fn()},
    catalogService: {imageUrl: jest.fn(() => ''), categoryTree: jest.fn()},
}));

// The camera is the entry point under test but not the thing under test:
// a stub button gives the scan a deterministic trigger and keeps
// html5-qrcode out of jsdom entirely.
jest.mock('./BarcodeScanner', () => function BarcodeScannerStub({onScan}) {
    const React2 = require('react');
    return React2.createElement('button', {
        type: 'button',
        'data-testid': 'scan-trigger',
        onClick: () => onScan('4870001'),
    }, 'scan');
});

// ClientLookupSheet (always mounted, closed) pulls in AddressMapPicker →
// react-leaflet, an ESM-only package CRA's jest transform can't parse.
jest.mock('./AddressMapPicker', () => function AddressMapPickerStub() {
    return null;
});

// The offline sync loop would otherwise keep a timer running for the whole file.
jest.mock('../../utils/offlineOrderSync', () => ({startSyncLoop: () => () => {}}));

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

// The consultant is assigned one warehouse. That matters beyond realism:
// `userWarehouseNames` empty makes productSheetView's `groupedByMine` false,
// which hides the "See all warehouses" toggle outright — and with it every
// path through handleShowOtherWarehouses.
const MY_WAREHOUSE = {id: 1, code: 'W1', name: 'Main'};

const CATALOG_HIT = {
    success: true,
    status: 200,
    data: {sku: 'NOM-1', sku_name: 'Held', article: 'A1', price: '9.99', images: []},
};
const CATALOG_HIT_SECOND = {
    success: true,
    status: 200,
    data: {sku: 'NOM-2', sku_name: 'Second', article: 'A2', price: '4.50', images: []},
};
const CATALOG_MISS = {success: false, status: 404, code: 'PRODUCT_NOT_IN_CATALOG'};
// The replica was never reached — not an answer about the product.
const CATALOG_DOWN = {success: false, status: null, code: null};
const STOCK_DOWN = {success: false, status: null, code: null};

const stockOk = (rows) => ({
    success: true,
    status: 200,
    data: {results: [{sku: '4870001', status: 'ok', stock: rows, unit: 'piece'}]},
});
const STOCK_NOT_FOUND = {
    success: true,
    status: 200,
    data: {results: [{sku: '4870001', status: 'not_found', stock: []}]},
};

// A promise whose settling this test controls, so "the card is on screen
// while stock is still in flight" is an observable state rather than a race.
const deferred = () => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return {promise, resolve};
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

// Fires the scan, then drains the microtask queue so the catalog half of the
// fan-out lands — without touching a stock promise the test has not resolved
// yet. That is the whole point: the two halves settle independently.
const settle = async () => {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
};

// Mount, then let the warehouse fetch land before anything is scanned:
// `userWarehouses` is loaded in an effect, and a scan fired before it
// resolves would send no warehouse codes and render an ungrouped sheet.
const mountDashboard = async () => {
    renderDashboard();
    await settle();
};

const scanAndSettleCatalog = async () => {
    fireEvent.click(screen.getByTestId('scan-trigger'));
    await settle();
};

describe('UserDashboard scan fan-out', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('language', 'en');
        jest.clearAllMocks();
        const {warehouseService, orderService, catalogService} = require('../../api');
        warehouseService.getWarehouses.mockResolvedValue({success: true, data: [MY_WAREHOUSE]});
        orderService.getOrders.mockResolvedValue({success: true, data: []});
        catalogService.categoryTree.mockResolvedValue({success: true, data: []});
    });

    afterEach(() => {
        localStorage.clear();
    });

    test('the card renders before stock arrives', async () => {
        const stock = deferred();
        productService.searchProduct.mockResolvedValue(CATALOG_HIT);
        productService.fetchStock.mockReturnValue(stock.promise);

        await mountDashboard();
        await scanAndSettleCatalog();

        // Stock is still in flight, yet the product is already on screen.
        expect(screen.getByRole('heading', {name: 'Held'})).toBeInTheDocument();
        expect(productService.fetchStock).toHaveBeenCalledTimes(1);
        // ...and the sheet says so rather than claiming an empty balance list.
        expect(screen.getByText(en.stockPending)).toBeInTheDocument();

        await act(async () => {
            stock.resolve(stockOk([{warehouse: 'W1', warehouse_name: 'Main', quantity: 4}]));
        });

        expect(screen.getByRole('heading', {name: 'Held'})).toBeInTheDocument();
        expect(screen.queryByText(en.stockPending)).toBeNull();
        expect(screen.getByRole('radio', {name: /Main/})).toBeInTheDocument();
    });

    test('the two calls go out together, not one after the other', async () => {
        const stock = deferred();
        productService.searchProduct.mockResolvedValue(CATALOG_HIT);
        productService.fetchStock.mockReturnValue(stock.promise);

        await mountDashboard();
        fireEvent.click(screen.getByTestId('scan-trigger'));

        // Both requests are issued in the same synchronous pass — no await on
        // the catalog read sits between them.
        expect(productService.searchProduct).toHaveBeenCalledTimes(1);
        expect(productService.fetchStock).toHaveBeenCalledTimes(1);
        expect(productService.searchProduct).toHaveBeenCalledWith(
            {sku: '4870001', searchType: 'barcode', recordScan: true},
        );
        // Scoped to the consultant's own warehouses; the "See all warehouses"
        // re-run is the only call that widens to [].
        expect(productService.fetchStock).toHaveBeenCalledWith(
            {items: [{sku: '4870001', isBarcode: true}], warehouseCodes: ['W1']},
        );

        await act(async () => {
            stock.resolve(stockOk([]));
        });
    });

    test('a 1C outage still shows the product, never a blank card', async () => {
        productService.searchProduct.mockResolvedValue(CATALOG_HIT);
        productService.fetchStock.mockResolvedValue({success: false, status: null});

        await mountDashboard();
        await scanAndSettleCatalog();

        expect(await screen.findByRole('heading', {name: 'Held'})).toBeInTheDocument();
        expect(await screen.findByText(en.stockUnavailable)).toBeInTheDocument();
        // A transport failure must never read as "no such product".
        expect(screen.queryByText(en.productNotFound)).toBeNull();
    });

    test('a replica miss says 1C is being checked, then renders the self-heal echo', async () => {
        const stock = deferred();
        productService.searchProduct.mockResolvedValue(CATALOG_MISS);
        productService.fetchStock.mockReturnValue(stock.promise);

        await mountDashboard();
        await scanAndSettleCatalog();

        // The sheet is open on a MISS too, or this notice has nowhere to go.
        expect(screen.getByText(en.catalogMissSearchingUpstream)).toBeInTheDocument();
        expect(screen.queryByText(en.outOfStock)).toBeNull();

        await act(async () => {
            stock.resolve({
                success: true,
                status: 200,
                data: {results: [{
                    sku: '4870001',
                    status: 'ok',
                    stock: [{warehouse: 'W1', warehouse_name: 'Main', quantity: 2}],
                    unit: 'piece',
                    product: {sku: 'NOM-9', sku_name: 'Discovered', article: 'A9', price: '5.00', images: []},
                }]},
            });
        });

        expect(screen.getByRole('heading', {name: 'Discovered'})).toBeInTheDocument();
        expect(screen.queryByText(en.catalogMissSearchingUpstream)).toBeNull();
    });

    test('a replica miss 1C cannot resolve either is the only not-found', async () => {
        const stock = deferred();
        productService.searchProduct.mockResolvedValue(CATALOG_MISS);
        productService.fetchStock.mockReturnValue(stock.promise);

        await mountDashboard();
        await scanAndSettleCatalog();
        expect(screen.getByText(en.catalogMissSearchingUpstream)).toBeInTheDocument();

        await act(async () => {
            stock.resolve(STOCK_NOT_FOUND);
        });

        expect(await screen.findByText(en.productNotFound)).toBeInTheDocument();
        await waitFor(() => {
            expect(screen.queryByText(en.catalogMissSearchingUpstream)).toBeNull();
        });
        // Both halves gave a real negative, so the miss belongs in the history.
        expect(getTodayScans()).toEqual([expect.objectContaining({search: '4870001', found: false})]);
    });

    test('both halves failing says the service is unreachable, not that the product is missing', async () => {
        productService.searchProduct.mockResolvedValue(CATALOG_DOWN);
        productService.fetchStock.mockResolvedValue(STOCK_DOWN);

        await mountDashboard();
        await scanAndSettleCatalog();

        expect(await screen.findByText(en.productSearchError)).toBeInTheDocument();
        expect(screen.queryByText(en.productNotFound)).toBeNull();
        // A lookup that failed is not evidence the product is missing, so
        // nothing is written to the day's scan history.
        expect(getTodayScans()).toEqual([]);
    });

    test('a replica miss with 1C unreachable is a service error, not a not-found', async () => {
        // The regression this guards: the replica genuinely does not hold the
        // product, but 1C — the only half that could still know it — never
        // answered. Telling the consultant "not found" here sends them away
        // from a product that may well be on the shelf.
        productService.searchProduct.mockResolvedValue(CATALOG_MISS);
        productService.fetchStock.mockResolvedValue(STOCK_DOWN);

        await mountDashboard();
        await scanAndSettleCatalog();

        expect(await screen.findByText(en.productSearchError)).toBeInTheDocument();
        expect(screen.queryByText(en.productNotFound)).toBeNull();
        expect(getTodayScans()).toEqual([]);
    });

    test('an upstream service code from the stock call is named in the toast', async () => {
        productService.searchProduct.mockResolvedValue(CATALOG_MISS);
        productService.fetchStock.mockResolvedValue({
            success: false, status: 503, code: 'EXTERNAL_SERVICE_UNAVAILABLE',
        });

        await mountDashboard();
        await scanAndSettleCatalog();

        expect(await screen.findByText(en.externalServiceUnavailable)).toBeInTheDocument();
        expect(screen.getByText(en.webServiceError)).toBeInTheDocument();
        expect(screen.queryByText(en.productNotFound)).toBeNull();
    });

    test('a late "other warehouses" answer never lands on a newer product', async () => {
        // handleShowOtherWarehouses runs OUTSIDE isSearchingRef, so nothing
        // stops the consultant scanning the next product while its batch call
        // is still out (the backend gives that call up to 25 s). When the old
        // answer lands it must be dropped: writing it would put product A's
        // warehouse rows under product B's card with no warning shown, and
        // ProductSheet would then auto-select one of them — so B could be
        // added to the order from a quantity that belongs to A.
        const others = deferred();
        const secondScanStock = deferred();
        productService.searchProduct
            .mockResolvedValueOnce(CATALOG_HIT)
            .mockResolvedValueOnce(CATALOG_HIT_SECOND);
        productService.fetchStock
            .mockResolvedValueOnce(stockOk([{warehouse: 'W1', warehouse_name: 'Main', quantity: 4}]))
            .mockReturnValueOnce(others.promise)
            .mockReturnValueOnce(secondScanStock.promise);

        await mountDashboard();
        await scanAndSettleCatalog();
        expect(await screen.findByRole('radio', {name: /Main/})).toBeInTheDocument();

        // "See all warehouses" — the request that is about to be outlived.
        fireEvent.click(screen.getByRole('button', {name: en.seeAllWarehouses}));
        await settle();
        expect(productService.fetchStock).toHaveBeenCalledTimes(2);
        expect(productService.fetchStock).toHaveBeenLastCalledWith(
            {items: [{sku: '4870001', isBarcode: true}], warehouseCodes: []},
        );

        // The consultant gives up waiting and scans the next product.
        await scanAndSettleCatalog();
        expect(await screen.findByRole('heading', {name: 'Second'})).toBeInTheDocument();
        expect(screen.getByText(en.stockPending)).toBeInTheDocument();

        // Only now does the first product's answer come back.
        await act(async () => {
            others.resolve(stockOk([
                {warehouse: 'W1', warehouse_name: 'Main', quantity: 99},
                {warehouse: 'W9', warehouse_name: 'Digomi', quantity: 42},
            ]));
        });

        // Nothing of product A's answer reached product B's card: the stock
        // leg is still pending (its `finally` did not steal the spinner
        // either), and no warehouse row was written.
        expect(screen.getByRole('heading', {name: 'Second'})).toBeInTheDocument();
        expect(screen.getByText(en.stockPending)).toBeInTheDocument();
        expect(screen.queryByText('Digomi')).toBeNull();
        expect(screen.queryByRole('radio', {name: /Main/})).toBeNull();
        // The stale run's `finally` must not clear the spinner either: the
        // toggle stays disabled because B's own lookup still owns `loading`.
        expect(screen.getByRole('button', {name: en.seeAllWarehouses})).toBeDisabled();

        // B's own answer still renders normally.
        await act(async () => {
            secondScanStock.resolve(
                stockOk([{warehouse: 'W1', warehouse_name: 'Main', quantity: 2}]),
            );
        });
        expect(screen.getByRole('radio', {name: /Main/})).toHaveTextContent(en.stockFree(2));
        expect(screen.queryByText('Digomi')).toBeNull();
    });
});

import React from 'react';
import {render, screen, fireEvent, act} from '@testing-library/react';
import OrdersView from './OrdersView';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';
import {orderService} from '../../api/services';

const en = translations.en;

jest.mock('../../api/services', () => ({
    orderService: {getOrders: jest.fn()},
}));

// jsdom lacks these browser APIs that antd's Segmented and Popconfirm touch.
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
});

// Fixed "now" for relativeTime/groupByDay — same reference point
// ordersListView.test.js uses, so today/yesterday fixtures line up.
const NOW = new Date('2026-09-18T12:00:00Z');

const order = (overrides = {}) => ({
    id: 1001,
    status: 'draft',
    customer_name: 'გიორგი ბერიძე',
    is_retail: false,
    items_count: 2,
    total: 100,
    created_at: '2026-09-18T11:00:00Z',
    ...overrides,
});

const renderView = (props = {}) => {
    const handlers = {
        onOpenOrder: jest.fn(),
        onPrint: jest.fn(),
        onDelete: jest.fn(),
        onNewOrder: jest.fn(),
    };
    const utils = render(
        <LanguageProvider>
            <OrdersView userId={7} activeOrderId={null} {...handlers} {...props}/>
        </LanguageProvider>
    );
    return {...handlers, ...utils};
};

// Advances the shared 300ms debounce timer and lets the fetch's microtasks
// (the await, then the state updates in its `finally`) settle.
const flushDebounce = async (ms = 300) => {
    await act(async () => {
        jest.advanceTimersByTime(ms);
        await Promise.resolve();
        await Promise.resolve();
    });
};

describe('OrdersView', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(NOW);
        localStorage.setItem('language', 'en');
        jest.clearAllMocks();
        orderService.getOrders.mockResolvedValue({success: true, data: []});
    });

    afterEach(() => {
        jest.useRealTimers();
        localStorage.removeItem('language');
    });

    it('fetches the draft segment scoped to the consultant on mount', async () => {
        renderView();
        await flushDebounce();
        expect(orderService.getOrders).toHaveBeenCalledWith({status: 'draft', created_by: 7});
    });

    it("selecting a segment issues getOrders with that segment's params", async () => {
        renderView();
        await flushDebounce();
        orderService.getOrders.mockClear();

        fireEvent.click(screen.getByRole('radio', {name: en.ordersSegmentConfirmed}));
        await flushDebounce();

        expect(orderService.getOrders).toHaveBeenCalledWith({status: 'confirmed'});
    });

    it('excludes the active order from the ღია (draft) segment', async () => {
        orderService.getOrders.mockResolvedValue({
            success: true,
            data: [
                order({id: 5, customer_name: 'Active Client'}),
                order({id: 6, customer_name: 'Other Client'}),
            ],
        });
        renderView({activeOrderId: 5});
        await flushDebounce();

        expect(screen.queryByText('Active Client')).toBeNull();
        expect(screen.getByText('Other Client')).toBeInTheDocument();
    });

    it('a search inside a segment sends both customer_search and the segment status', async () => {
        renderView();
        await flushDebounce();
        orderService.getOrders.mockClear();

        fireEvent.change(screen.getByPlaceholderText(en.searchByCustomer), {target: {value: 'Beridze'}});
        await flushDebounce();

        expect(orderService.getOrders).toHaveBeenCalledWith({status: 'draft', customer_search: 'Beridze'});
    });

    it('both fetch paths unwrap a paginated {results} response the same as a bare array', async () => {
        orderService.getOrders.mockResolvedValue({
            success: true,
            data: {results: [order({id: 77, customer_name: 'Paginated Client'})], count: 1},
        });
        renderView();
        await flushDebounce();

        expect(screen.getByText('Paginated Client')).toBeInTheDocument();
    });

    it('discards an older response that resolves after a newer one', async () => {
        let resolveFirst;
        let resolveSecond;
        orderService.getOrders
            .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
            .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

        renderView();
        await flushDebounce();
        expect(orderService.getOrders).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('radio', {name: en.ordersSegmentConfirmed}));
        await flushDebounce();
        expect(orderService.getOrders).toHaveBeenCalledTimes(2);

        // The newer (second) request resolves first.
        await act(async () => {
            resolveSecond({success: true, data: [order({id: 9, status: 'confirmed', customer_name: 'New Result'})]});
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(screen.getByText('New Result')).toBeInTheDocument();

        // The abandoned, older request resolves last — must be dropped.
        await act(async () => {
            resolveFirst({success: true, data: [order({id: 8, status: 'draft', customer_name: 'Old Result'})]});
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(screen.queryByText('Old Result')).toBeNull();
        expect(screen.getByText('New Result')).toBeInTheDocument();
    });

    it('renders rows grouped under today / yesterday headings', async () => {
        orderService.getOrders.mockResolvedValue({
            success: true,
            data: [
                order({id: 1, customer_name: 'Today Client', created_at: '2026-09-18T11:00:00Z'}),
                order({id: 2, customer_name: 'Yesterday Client', created_at: '2026-09-17T18:20:00Z'}),
            ],
        });
        renderView();
        await flushDebounce();

        expect(screen.getByText(en.today)).toBeInTheDocument();
        expect(screen.getByText(en.yesterday)).toBeInTheDocument();
        expect(screen.getByText('Today Client')).toBeInTheDocument();
        expect(screen.getByText('Yesterday Client')).toBeInTheDocument();
    });

    it("a draft row's tap calls onOpenOrder", async () => {
        orderService.getOrders.mockResolvedValue({
            success: true,
            data: [order({id: 42, customer_name: 'Tap Client'})],
        });
        const {onOpenOrder} = renderView();
        await flushDebounce();

        fireEvent.click(screen.getByText('Tap Client'));
        expect(onOpenOrder).toHaveBeenCalledWith(42);
    });

    it("a confirmed row's tap does not call onOpenOrder", async () => {
        orderService.getOrders.mockResolvedValue({
            success: true,
            data: [order({id: 43, status: 'confirmed', customer_name: 'No Tap Client'})],
        });
        const {onOpenOrder} = renderView();
        fireEvent.click(screen.getByRole('radio', {name: en.ordersSegmentConfirmed}));
        await flushDebounce();

        fireEvent.click(screen.getByText('No Tap Client'));
        expect(onOpenOrder).not.toHaveBeenCalled();
    });

    it('the printer icon calls onPrint for any status and never onOpenOrder', async () => {
        orderService.getOrders.mockResolvedValue({
            success: true,
            data: [order({id: 44, status: 'completed', customer_name: 'Print Client'})],
        });
        const {onPrint, onOpenOrder} = renderView();
        fireEvent.click(screen.getByRole('radio', {name: en.ordersSegmentCompleted}));
        await flushDebounce();

        fireEvent.click(screen.getByRole('button', {name: `${en.printInvoice} #44`}));
        expect(onPrint).toHaveBeenCalledWith(44);
        expect(onOpenOrder).not.toHaveBeenCalled();
    });

    it('the trash icon deletes a draft behind its confirm and never calls onOpenOrder', async () => {
        orderService.getOrders.mockResolvedValue({
            success: true,
            data: [order({id: 45, customer_name: 'Delete Client'})],
        });
        const {onDelete, onOpenOrder} = renderView();
        await flushDebounce();

        fireEvent.click(screen.getByRole('button', {name: `${en.delete} #45`}));
        expect(onDelete).not.toHaveBeenCalled();
        fireEvent.click(await screen.findByRole('button', {name: en.yes}));

        expect(onDelete).toHaveBeenCalledWith(45);
        expect(onOpenOrder).not.toHaveBeenCalled();
    });

    it('a confirmed row offers no trash icon', async () => {
        orderService.getOrders.mockResolvedValue({
            success: true,
            data: [order({id: 46, status: 'confirmed', customer_name: 'No Trash Client'})],
        });
        renderView();
        fireEvent.click(screen.getByRole('radio', {name: en.ordersSegmentConfirmed}));
        await flushDebounce();

        expect(screen.queryByRole('button', {name: `${en.delete} #46`})).toBeNull();
    });

    it('shows the idle-segment empty copy for an empty draft segment', async () => {
        renderView();
        await flushDebounce();

        expect(screen.getByText(en.noIncompleteOrders)).toBeInTheDocument();
    });

    it('shows the fruitless-search empty copy once a search comes back empty', async () => {
        renderView();
        await flushDebounce();

        fireEvent.change(screen.getByPlaceholderText(en.searchByCustomer), {target: {value: 'zzz'}});
        await flushDebounce();

        expect(screen.getByText(en.noOrders)).toBeInTheDocument();
        expect(screen.queryByText(en.noIncompleteOrders)).toBeNull();
    });

    it('calls onNewOrder from the navbar plus button', () => {
        const {onNewOrder} = renderView();
        fireEvent.click(screen.getByRole('button', {name: en.newOrder}));
        expect(onNewOrder).toHaveBeenCalledTimes(1);
    });
});

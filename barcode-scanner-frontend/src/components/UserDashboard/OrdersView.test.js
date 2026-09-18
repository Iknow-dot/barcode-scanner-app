import React, {useState} from 'react';
import {render, screen, fireEvent, act} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

// relativeTime/groupByDay (ordersListView.js) bucket by the *local* calendar
// day, so this suite needs a fixed local time zone to be deterministic across
// machines/CI — same reasoning and same pin as ordersListView.test.js.
// Scoped to this file only (set in beforeAll, not src/setupTests.js) and
// restored in afterAll by deleting the var rather than assigning `undefined`
// (which Node would stringify to the literal string "undefined" and break TZ
// resolution for whichever suite this Jest worker runs next).
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
    process.env.TZ = 'Asia/Tbilisi';
});
afterAll(() => {
    if (ORIGINAL_TZ === undefined) {
        delete process.env.TZ;
    } else {
        process.env.TZ = ORIGINAL_TZ;
    }
});

// Fixed "now" for relativeTime/groupByDay — same reference point
// ordersListView.test.js uses (Tbilisi local: 2026-09-18 16:00), so
// today/yesterday fixtures line up.
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

// OrdersView.js (F3 fix) no longer owns `segment`/`query` state itself — the
// real app (UserDashboard.js) lifts both so they survive a tab switch. This
// harness plays UserDashboard's part: it owns the state and passes it down
// as controlled props, exactly like the real parent does, so the rest of
// this suite exercises OrdersView through the same contract production uses.
// `visible` mimics UserDashboard's `activeTab === 'orders' && <OrdersView/>`
// conditional mount — toggling it unmounts/remounts OrdersView while the
// harness (standing in for UserDashboard) keeps its state, which is exactly
// what a tab switch does to the real component tree.
const OrdersViewHarness = ({initialSegment = 'draft', initialQuery = '', visible = true, ...rest}) => {
    const [segment, setSegment] = useState(initialSegment);
    const [query, setQuery] = useState(initialQuery);
    if (!visible) return null;
    return (
        <OrdersView
            segment={segment}
            onSegmentChange={setSegment}
            query={query}
            onQueryChange={setQuery}
            {...rest}
        />
    );
};

const renderView = (props = {}) => {
    const handlers = {
        onOpenOrder: jest.fn(),
        onPrint: jest.fn(),
        onDelete: jest.fn(),
        onNewOrder: jest.fn(),
    };
    const utils = render(
        <LanguageProvider>
            <OrdersViewHarness userId={7} activeOrderId={null} {...handlers} {...props}/>
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

// A segment change fetches immediately (no setTimeout at all) — this only
// drains the microtask queue the immediate async fetch runs on. Deliberately
// does NOT call jest.advanceTimersByTime, to prove no timer is involved.
const flushMicrotasks = async () => {
    await act(async () => {
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

    it('fetches immediately on a segment change — no debounce timer involved', async () => {
        renderView();
        await flushMicrotasks();
        orderService.getOrders.mockClear();

        fireEvent.click(screen.getByRole('radio', {name: en.ordersSegmentConfirmed}));
        // Deliberately no jest.advanceTimersByTime — a segment tap must not
        // need one.
        await flushMicrotasks();

        expect(orderService.getOrders).toHaveBeenCalledWith({status: 'confirmed'});
    });

    it("keeps typing debounced at 300ms, unlike a segment change", async () => {
        renderView();
        await flushMicrotasks();
        orderService.getOrders.mockClear();

        fireEvent.change(screen.getByPlaceholderText(en.searchByCustomer), {target: {value: 'Ber'}});
        await act(async () => {
            jest.advanceTimersByTime(299);
        });
        expect(orderService.getOrders).not.toHaveBeenCalled();

        await act(async () => {
            jest.advanceTimersByTime(1);
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(orderService.getOrders).toHaveBeenCalledWith({status: 'draft', customer_search: 'Ber'});
    });

    it("does not show the previous segment's rows under the new segment's pill while its fetch is in flight", async () => {
        orderService.getOrders.mockResolvedValueOnce({
            success: true,
            data: [order({id: 51, customer_name: 'Draft Client'})],
        });
        renderView();
        await flushMicrotasks();
        expect(screen.getByText('Draft Client')).toBeInTheDocument();

        let resolveConfirmed;
        orderService.getOrders.mockImplementationOnce(() => new Promise((resolve) => { resolveConfirmed = resolve; }));

        fireEvent.click(screen.getByRole('radio', {name: en.ordersSegmentConfirmed}));
        await flushMicrotasks();

        // The confirmed fetch is still pending: the draft row must be gone
        // (not left over under the confirmed pill), and the gap must not
        // read as a genuine "no orders in this segment" empty state either.
        expect(screen.queryByText('Draft Client')).toBeNull();
        expect(screen.queryByText(en.noOrdersInSegment)).toBeNull();
        expect(document.querySelector('.if-spinner')).toBeInTheDocument();

        await act(async () => {
            resolveConfirmed({
                success: true,
                data: [order({id: 52, status: 'confirmed', customer_name: 'Confirmed Client'})],
            });
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(screen.getByText('Confirmed Client')).toBeInTheDocument();
        expect(document.querySelector('.if-spinner')).toBeNull();
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

    it('calls onNewOrder from the navbar plus button', async () => {
        const {onNewOrder} = renderView();
        // Mount now fetches immediately (fix round 1) — settle it before the
        // test ends, or its pending promise resolves after teardown.
        await flushMicrotasks();
        fireEvent.click(screen.getByRole('button', {name: en.newOrder}));
        expect(onNewOrder).toHaveBeenCalledTimes(1);
    });

    // F5a fix round 1: nothing asserted the actual rendered time text, so the
    // ordersListView.js rename (minutesAgo -> minAgo) silently blanked every
    // 1-59-minute-old row. One render per relativeTime branch, each checking
    // the real text — not just that *some* text is present.
    describe('row relative time text', () => {
        const trailingTime = () => document.querySelector('.if-row-trailing .if-row-subtitle');

        it('shows "just now" for an order a few seconds old', async () => {
            orderService.getOrders.mockResolvedValueOnce({
                success: true,
                data: [order({id: 60, customer_name: 'Just Now Client', created_at: '2026-09-18T11:59:50Z'})],
            });
            renderView();
            await flushMicrotasks();

            expect(trailingTime()).toHaveTextContent(en.justNow);
        });

        it('shows "N min ago" for an order 25 minutes old', async () => {
            orderService.getOrders.mockResolvedValueOnce({
                success: true,
                data: [order({id: 61, customer_name: 'Min Ago Client', created_at: '2026-09-18T11:35:00Z'})],
            });
            renderView();
            await flushMicrotasks();

            expect(trailingTime()).toHaveTextContent(en.minAgo(25));
        });

        it('shows "Nh ago" for an order 3 hours old, same local day', async () => {
            orderService.getOrders.mockResolvedValueOnce({
                success: true,
                data: [order({id: 62, customer_name: 'Hours Ago Client', created_at: '2026-09-18T09:00:00Z'})],
            });
            renderView();
            await flushMicrotasks();

            expect(trailingTime()).toHaveTextContent(en.hoursAgo(3));
        });

        it('shows the local clock time for an order from an earlier day', async () => {
            orderService.getOrders.mockResolvedValueOnce({
                success: true,
                // 2026-09-17T18:20:00Z is 2026-09-17 22:20 Tbilisi local — an
                // earlier local day than NOW (2026-09-18 16:00 Tbilisi).
                data: [order({id: 63, customer_name: 'Clock Client', created_at: '2026-09-17T18:20:00Z'})],
            });
            renderView();
            await flushMicrotasks();

            expect(trailingTime()).toHaveTextContent('22:20');
        });

        it('shows no time text for an order with no timestamp', async () => {
            orderService.getOrders.mockResolvedValueOnce({
                success: true,
                data: [order({id: 64, customer_name: 'No Timestamp Client', created_at: null})],
            });
            renderView();
            await flushMicrotasks();

            expect(screen.getByText('No Timestamp Client')).toBeInTheDocument();
            expect(trailingTime()).toHaveTextContent('');
        });
    });

    // F8 (guard half): the `!userId` early return used to bail out of the
    // effect without resetting `loading`, so a userId that clears while a
    // fetch is in flight left the spinner stranded forever (the segment is
    // "empty" — orders got cleared — but loading never goes back to false).
    it('does not strand the loading spinner if userId clears while mounted', async () => {
        orderService.getOrders.mockImplementationOnce(() => new Promise(() => {})); // never resolves
        const handlers = {
            onOpenOrder: jest.fn(), onPrint: jest.fn(), onDelete: jest.fn(), onNewOrder: jest.fn(),
        };
        const {rerender} = render(
            <LanguageProvider>
                <OrdersViewHarness userId={7} activeOrderId={null} {...handlers}/>
            </LanguageProvider>
        );
        await flushMicrotasks();
        expect(document.querySelector('.if-spinner')).toBeInTheDocument();

        rerender(
            <LanguageProvider>
                <OrdersViewHarness userId={null} activeOrderId={null} {...handlers}/>
            </LanguageProvider>
        );

        expect(document.querySelector('.if-spinner')).toBeNull();
        expect(screen.getByText(en.noIncompleteOrders)).toBeInTheDocument();
    });

    // F2: a failed fetch used to fall through to `setOrders([])`, which reads
    // as the exact same "no orders" copy as a genuinely empty segment — a
    // consultant on flaky shop Wi-Fi couldn't tell a network failure from
    // "my drafts are gone."
    describe('a failed fetch', () => {
        it('shows a distinct failure state instead of the genuine-empty copy', async () => {
            orderService.getOrders.mockResolvedValueOnce({success: false, error: en.networkError});
            renderView();
            await flushMicrotasks();

            expect(screen.getByText(en.networkError)).toBeInTheDocument();
            expect(screen.queryByText(en.noIncompleteOrders)).toBeNull();
        });

        it('offers a retry that refetches and clears the failure state on success', async () => {
            orderService.getOrders.mockResolvedValueOnce({success: false, error: en.networkError});
            renderView();
            await flushMicrotasks();
            expect(screen.getByText(en.networkError)).toBeInTheDocument();

            orderService.getOrders.mockResolvedValueOnce({
                success: true,
                data: [order({id: 70, customer_name: 'Recovered Client'})],
            });
            fireEvent.click(screen.getByRole('button', {name: en.refreshData}));
            await flushMicrotasks();

            expect(screen.getByText('Recovered Client')).toBeInTheDocument();
            expect(screen.queryByText(en.networkError)).toBeNull();
        });
    });

    // F3: OrdersView used to own `segment`/`query` as local state, so every
    // tab switch (UserDashboard unmounts OrdersView when activeTab !==
    // 'orders') silently reset both to their defaults. The harness above
    // stands in for UserDashboard: it owns the state and OrdersView only
    // renders it, so a tab switch (visible -> false -> true, same harness
    // instance) must not lose the consultant's choices.
    it('keeps the chosen segment and search text after a tab switch away and back', async () => {
        orderService.getOrders.mockResolvedValue({success: true, data: []});
        const handlers = {
            onOpenOrder: jest.fn(),
            onPrint: jest.fn(),
            onDelete: jest.fn(),
            onNewOrder: jest.fn(),
        };
        const {rerender} = render(
            <LanguageProvider>
                <OrdersViewHarness userId={7} activeOrderId={null} {...handlers} visible/>
            </LanguageProvider>
        );
        await flushMicrotasks();

        fireEvent.click(screen.getByRole('radio', {name: en.ordersSegmentConfirmed}));
        await flushMicrotasks();
        fireEvent.change(screen.getByPlaceholderText(en.searchByCustomer), {target: {value: 'Beridze'}});
        await flushDebounce();

        // Tab away: OrdersView unmounts (the harness stays mounted, holding
        // the state — exactly like UserDashboard's conditional render).
        rerender(
            <LanguageProvider>
                <OrdersViewHarness userId={7} activeOrderId={null} {...handlers} visible={false}/>
            </LanguageProvider>
        );

        // Tab back: OrdersView remounts.
        orderService.getOrders.mockClear();
        rerender(
            <LanguageProvider>
                <OrdersViewHarness userId={7} activeOrderId={null} {...handlers} visible/>
            </LanguageProvider>
        );
        await flushMicrotasks();

        expect(screen.getByRole('radio', {name: en.ordersSegmentConfirmed})).toBeChecked();
        expect(screen.getByPlaceholderText(en.searchByCustomer)).toHaveValue('Beridze');
        // The remount still refreshes immediately (existing refresh
        // behaviour), now scoped to the segment/query that survived.
        expect(orderService.getOrders).toHaveBeenCalledWith({status: 'confirmed', customer_search: 'Beridze'});
    });

    // F4: onKeyDown sat on the row and only the nested buttons' onClick
    // stopped *pointer* propagation — a bubbled Enter/Space from the printer
    // or trash button still hit the row's handler, which preventDefault'd
    // the button's own activation and opened the row instead.
    describe('keyboard activation on the row icons', () => {
        it('Enter on the printer icon prints and does not open the row', async () => {
            orderService.getOrders.mockResolvedValueOnce({
                success: true,
                data: [order({id: 80, customer_name: 'Keyboard Print Client'})],
            });
            const user = userEvent.setup({delay: null});
            const {onPrint, onOpenOrder} = renderView();
            await flushMicrotasks();

            const printBtn = screen.getByRole('button', {name: `${en.printInvoice} #80`});
            printBtn.focus();
            await user.keyboard('{Enter}');

            expect(onPrint).toHaveBeenCalledWith(80);
            expect(onOpenOrder).not.toHaveBeenCalled();
        });

        it('Space on the trash icon opens the delete confirm and does not open the row', async () => {
            orderService.getOrders.mockResolvedValueOnce({
                success: true,
                data: [order({id: 81, customer_name: 'Keyboard Delete Client'})],
            });
            const user = userEvent.setup({delay: null});
            const {onDelete, onOpenOrder} = renderView();
            await flushMicrotasks();

            const trashBtn = screen.getByRole('button', {name: `${en.delete} #81`});
            trashBtn.focus();
            await user.keyboard('[Space]');

            // Space opens the Popconfirm; it must not itself call onDelete or
            // open the row.
            expect(await screen.findByRole('button', {name: en.yes})).toBeInTheDocument();
            expect(onDelete).not.toHaveBeenCalled();
            expect(onOpenOrder).not.toHaveBeenCalled();
        });

        it("the row's accessible name is not polluted by the nested print/delete button labels", async () => {
            orderService.getOrders.mockResolvedValueOnce({
                success: true,
                data: [order({id: 82, customer_name: 'Named Row Client'})],
            });
            renderView();
            await flushMicrotasks();

            const row = screen.getByRole('button', {name: new RegExp(`Named Row Client`)});
            expect(row.getAttribute('aria-label')).not.toMatch(/Print invoice/i);
            expect(row.getAttribute('aria-label')).not.toMatch(/Delete/i);
        });
    });
});

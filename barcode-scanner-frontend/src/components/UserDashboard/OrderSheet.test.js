import React from 'react';
import {act, render, screen, fireEvent, waitFor, within} from '@testing-library/react';
import OrderSheet from './OrderSheet';
import AuthContext from '../Auth/AuthContext';
import {orderService, productService} from '../../api';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';

jest.mock('../../api', () => ({
    orderService: {
        updateOrder: jest.fn(),
        updateOrderItem: jest.fn(),
        removeOrderItem: jest.fn(),
        addOrderItem: jest.fn(),
    },
    productService: {fetchStock: jest.fn()},
}));

const en = translations.en;

// jsdom lacks these browser APIs that antd's Drawer (under IosSheet/IosActionSheet) touches.
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

const item = (overrides) => ({
    id: 1,
    sku: 'PAN',
    sku_name: 'Granite pan',
    article: 'MG-2814',
    warehouse_code: 'W1',
    warehouse_name: 'Vake',
    quantity: '2',
    price: '89.90',
    effective_price: '89.90',
    discount_percent: '0.00',
    line_total: '179.80',
    is_gift: false,
    unit: 'piece',
    ...overrides,
});

const ORDER = {
    id: 42,
    customer_name: 'Giorgi Beridze',
    customer_identification_number: '01024012345',
    customer_phone: '555123456',
    delivery_type: 'pickup',
    total: '299.30',
    items: [
        item(),
        item({id: 2, sku: 'KETTLE', sku_name: 'Kettle', article: 'EK-1700', quantity: '1', price: '119.50', effective_price: '119.50', line_total: '119.50'}),
        item({id: 3, quantity: '1', is_gift: true, line_total: '0.00'}),
    ],
};

const AUTH = {authData: {user: {can_apply_discount: false, max_discount_percent: '0'}, gift_marking_enabled: true}};

// `auth` swaps the AuthContext value; everything else is an OrderSheet prop.
// `rerender` hands the open sheet new props, the way the dashboard re-renders
// it with a new `order` from outside.
const renderSheet = ({auth = AUTH, ...props} = {}) => {
    const handlers = {
        onClose: jest.fn(),
        onOrderUpdate: jest.fn(),
        onSaveForLater: jest.fn(),
        onProceedToPayment: jest.fn(),
        onDeleteOrder: jest.fn(),
        onChangeCustomer: jest.fn(),
        notify: {error: jest.fn()},
    };
    const tree = (sheetProps) => (
        <AuthContext.Provider value={auth}>
            <LanguageProvider>
                <OrderSheet open order={ORDER} confirmDisabled={false} {...handlers} {...sheetProps}/>
            </LanguageProvider>
        </AuthContext.Provider>
    );
    const {rerender} = render(tree(props));
    return {...handlers, rerender: (next) => rerender(tree({...props, ...next}))};
};

describe('OrderSheet', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
        jest.clearAllMocks();
        // Stock lookups stay pending unless a test answers them, so no state
        // update lands after a test has finished.
        productService.fetchStock.mockImplementation(() => new Promise(() => {}));
    });

    afterEach(() => {
        localStorage.removeItem('language');
    });

    it('opens on the cart step with the client and products by warehouse', async () => {
        productService.fetchStock.mockResolvedValue({
            success: true,
            data: {
                results: [
                    {sku: 'MG-2814', status: 'ok', stock: [{warehouse: 'W1', quantity: 9}]},
                    {sku: 'EK-1700', status: 'ok', stock: [{warehouse: 'W1', quantity: 9}]},
                ],
            },
        });
        renderSheet();
        const sheet = screen.getByRole('dialog', {name: en.cart});
        expect(sheet).toHaveTextContent(`1 / 2 · ${en.stepProducts}`);
        expect(within(sheet).getByRole('button', {name: /Giorgi Beridze/})).toHaveTextContent('01024012345 · 555123456');
        const vake = within(sheet).getByRole('region', {name: 'Vake'});
        expect(vake).toHaveTextContent(en.productsInWarehouse(2));
        expect(within(vake).getByText('Granite pan')).toBeInTheDocument();
        expect(within(vake).getByText('Kettle')).toBeInTheDocument();
        await waitFor(() => expect(within(vake).getAllByText(`${en.stockRemaining}: 9`)).toHaveLength(2));
        expect(productService.fetchStock).toHaveBeenCalledTimes(1);
        expect(productService.fetchStock).toHaveBeenCalledWith({
            items: [{sku: 'MG-2814', isBarcode: false}, {sku: 'EK-1700', isBarcode: false}],
            warehouseCodes: [],
        });
    });

    it('warns in the cart when a product could not be resolved against 1C', async () => {
        productService.fetchStock.mockResolvedValue({
            success: true,
            data: {
                results: [
                    {sku: 'MG-2814', status: 'ok', stock: [{warehouse: 'W1', quantity: 9}]},
                    {sku: 'EK-1700', status: 'unavailable', stock: []},
                ],
            },
        });
        renderSheet();
        // Not while the answer is still out — see the useSkuStock tests.
        expect(screen.queryByText(en.cartStockIncomplete)).toBeNull();
        expect(await screen.findByText(en.cartStockIncomplete)).toBeInTheDocument();
    });

    it('warns in the cart when the stock request fails outright', async () => {
        productService.fetchStock.mockResolvedValue({success: false, status: 502});
        renderSheet();
        expect(await screen.findByText(en.cartStockIncomplete)).toBeInTheDocument();
    });

    it('says nothing when every product resolved', async () => {
        productService.fetchStock.mockResolvedValue({
            success: true,
            data: {
                results: [
                    {sku: 'MG-2814', status: 'ok', stock: [{warehouse: 'W1', quantity: 9}]},
                    {sku: 'EK-1700', status: 'ok', stock: [{warehouse: 'W1', quantity: 4}]},
                ],
            },
        });
        renderSheet();
        await waitFor(() => expect(screen.getAllByText(`${en.stockRemaining}: 9`).length).toBeGreaterThan(0));
        expect(screen.queryByText(en.cartStockIncomplete)).toBeNull();
    });

    // Two SKUs sharing one article draw on one 1C balance, which useSkuStock
    // fans out to both. The confirm sums them (6 + 6 > 9) and refuses, so the
    // cart must warn on both rows instead of weighing each 6 against 9 alone.
    describe('with two SKUs sharing an article', () => {
        const sharedOrder = (quantity) => ({
            ...ORDER,
            items: [
                item({quantity}),
                item({id: 2, sku: 'LID', sku_name: 'Pan lid', quantity}),
            ],
        });

        beforeEach(() => {
            productService.fetchStock.mockResolvedValue({
                success: true,
                data: {results: [{sku: 'MG-2814', status: 'ok', stock: [{warehouse: 'W1', quantity: 9}]}]},
            });
        });

        it('warns on both rows once together they exceed the balance', async () => {
            renderSheet({order: sharedOrder('6')});
            // Each 6 fits the 9 alone; only the pooled 12 does not, so both rows
            // say it is the other line that pushes them over.
            await waitFor(() => expect(screen.getAllByText(en.exceedsStockPooled(9))).toHaveLength(2));
            expect(screen.queryByText(en.exceedsStock(9))).toBeNull();
            expect(screen.queryByText(`${en.stockRemaining}: 9`)).toBeNull();
        });

        it('shows the balance on both rows while together they fit it', async () => {
            renderSheet({order: sharedOrder('4')});
            await waitFor(() => expect(screen.getAllByText(`${en.stockRemaining}: 9`)).toHaveLength(2));
            expect(screen.queryByText(en.exceedsStock(9))).toBeNull();
            expect(screen.queryByText(en.exceedsStockPooled(9))).toBeNull();
        });
    });

    it('totals units and gifts in the bar', () => {
        renderSheet();
        expect(screen.getByText(`${en.cartTotalCount(4)} · 1 ${en.giftLabel}`)).toBeInTheDocument();
        expect(screen.getByText('299.30 ₾')).toBeInTheDocument();
    });

    it('changes the customer from the client row', () => {
        const {onChangeCustomer} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: /Giorgi Beridze/}));
        expect(onChangeCustomer).toHaveBeenCalledTimes(1);
    });

    it('cannot go on without products', () => {
        renderSheet({order: {...ORDER, items: [], total: '0.00'}});
        expect(screen.getByRole('button', {name: en.nextStep})).toBeDisabled();
        expect(screen.getByText(en.scanToAddProduct)).toBeInTheDocument();
    });

    it('goes to delivery and back', () => {
        renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.nextStep}));
        const delivery = screen.getByRole('dialog', {name: en.stepDelivery});
        expect(delivery).toHaveTextContent('2 / 2');
        expect(screen.queryByRole('button', {name: en.moreActions})).toBeNull();
        expect(within(delivery).getByRole('heading', {name: en.orderSummary})).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: en.back}));
        expect(screen.getByRole('dialog', {name: en.cart})).toBeInTheDocument();
    });

    // Task: the confirm popover is gone — tapping Confirm proceeds on the
    // first tap. Fails if handleConfirm still waits on any Yes/No gate, or if
    // onProceedToPayment isn't reached without one.
    it('confirms the order from the delivery step on the first tap, with no popover gate', async () => {
        const {onProceedToPayment} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.nextStep}));
        expect(screen.getByText(en.total)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: en.confirmOrder}));

        await waitFor(() => expect(onProceedToPayment).toHaveBeenCalledTimes(1));
        expect(screen.queryByText(en.yes)).not.toBeInTheDocument();
        expect(screen.queryByText(en.no)).not.toBeInTheDocument();
    });

    it('flushes a pending delivery edit before confirming, and waits for it to land', async () => {
        // F6: confirming used to unmount DeliveryStep immediately, whose own
        // unmount-flush then PATCHed an order already marked confirmed. Now
        // that Confirm has no popover gate, this exercises handleConfirm's
        // real path directly: a single tap must still await the flush before
        // calling onProceedToPayment, not just fire it eagerly.
        let resolveUpdate;
        orderService.updateOrder.mockReturnValue(new Promise((resolve) => { resolveUpdate = resolve; }));
        const {onProceedToPayment} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.nextStep}));

        const comment = screen.getByRole('textbox', {name: en.orderNotes});
        fireEvent.change(comment, {target: {value: 'Call first'}});
        // No blur: the debounce timer is still pending when Confirm is tapped.

        fireEvent.click(screen.getByRole('button', {name: en.confirmOrder}));

        expect(orderService.updateOrder).toHaveBeenCalledWith(42, {notes: 'Call first'});
        expect(onProceedToPayment).not.toHaveBeenCalled();

        resolveUpdate({success: true, data: {...ORDER, notes: 'Call first'}});
        await waitFor(() => expect(onProceedToPayment).toHaveBeenCalledTimes(1));
    });

    it('cannot confirm while offline or with unsynced changes', () => {
        renderSheet({confirmDisabled: true});
        fireEvent.click(screen.getByRole('button', {name: en.nextStep}));
        expect(screen.getByRole('button', {name: en.confirmOrder})).toBeDisabled();
    });

    // F1 (Critical): the removed Popconfirm used to be the de-facto
    // double-submit guard — its Yes button unmounted on tap, so a second tap
    // hit nothing. Nothing replaced it: handleConfirm set no state, so the
    // button stayed live for the whole round trip and a second tap during a
    // slow confirm reached onProceedToPayment (and so the 1C push) again,
    // capable of creating two real orders for one cart. Fails against the
    // pre-fix code because the button has no `disabled`/in-flight state at
    // all: the second fireEvent.click is never blocked, so
    // onProceedToPayment is called twice instead of once.
    it('blocks a second tap while a confirm is in flight', async () => {
        let resolveConfirm;
        const onProceedToPayment = jest.fn(() => new Promise((resolve) => { resolveConfirm = resolve; }));
        renderSheet({onProceedToPayment});
        fireEvent.click(screen.getByRole('button', {name: en.nextStep}));
        const confirmBtn = screen.getByRole('button', {name: en.confirmOrder});

        fireEvent.click(confirmBtn);
        expect(confirmBtn).toBeDisabled();
        // A disabled button does not receive a second click in a real
        // browser; this only proves the guard exists rather than relying on
        // it (same pattern CartItemRow.test.js's busy-guard tests use).
        fireEvent.click(confirmBtn);
        await waitFor(() => expect(onProceedToPayment).toHaveBeenCalledTimes(1));

        resolveConfirm();
        await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    });

    // F1: a guard that only clears on SUCCESS wedges the button shut after a
    // FAILED confirm — this project has shipped that exact bug twice before.
    // handleProceedToPayment never throws (it notifies and returns on a
    // failure response), so this exercises the same "the awaited call
    // settles" path a real failure takes, and checks the button is usable
    // again afterwards. Fails against the pre-fix code for the same reason
    // as the test above (no disabled state at all — this one would actually
    // already pass by accident pre-fix, which is exactly why the OTHER
    // direction above is the one that proves the guard exists).
    it('re-enables the confirm button after a settled (e.g. failed) confirm, and allows trying again', async () => {
        let resolveConfirm;
        const onProceedToPayment = jest.fn(() => new Promise((resolve) => { resolveConfirm = resolve; }));
        renderSheet({onProceedToPayment});
        fireEvent.click(screen.getByRole('button', {name: en.nextStep}));
        const confirmBtn = screen.getByRole('button', {name: en.confirmOrder});

        fireEvent.click(confirmBtn);
        await waitFor(() => expect(onProceedToPayment).toHaveBeenCalledTimes(1));
        resolveConfirm(); // the order stays mounted either way; only a successful confirm unmounts it via showOrderPanel
        await waitFor(() => expect(confirmBtn).not.toBeDisabled());

        fireEvent.click(confirmBtn);
        await waitFor(() => expect(onProceedToPayment).toHaveBeenCalledTimes(2));
    });

    // F5 (Minor): the ⋯ menu passed no `title` to IosActionSheet, so its
    // aria-labelledby pointed at an empty <h2> — a screen-reader user
    // entered an unnamed dialog. Fails against the pre-fix code because no
    // dialog with an accessible name is found at all (getByRole below
    // throws instead of matching the untitled one).
    it('names the ⋯ menu dialog, for screen readers', async () => {
        renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.moreActions}));
        expect(await screen.findByRole('dialog', {name: en.moreActions})).toBeInTheDocument();
    });

    // Task: the ⋯ menu is now an IosActionSheet (rows are plain buttons, not
    // antd menuitems). Fails if the sheet doesn't open, or if selecting the
    // row doesn't call the handler.
    it('saves the order for later from the ⋯ menu', async () => {
        const {onSaveForLater} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.moreActions}));
        fireEvent.click(await screen.findByRole('button', {name: en.saveForLater}));
        expect(onSaveForLater).toHaveBeenCalledTimes(1);
    });

    it('changes the customer from the ⋯ menu', async () => {
        const {onChangeCustomer} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.moreActions}));
        fireEvent.click(await screen.findByRole('button', {name: en.changeCustomer}));
        expect(onChangeCustomer).toHaveBeenCalledTimes(1);
    });

    // Task: instant delete — the destructive row in the action sheet IS the
    // deliberate gesture, so selecting it calls onDeleteOrder directly on the
    // first tap. Fails if onDeleteOrder needs a second confirming tap, or if
    // it isn't called at all.
    it('deletes the order from the ⋯ menu on the first tap, with no confirm step', async () => {
        const {onDeleteOrder} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.moreActions}));
        const deleteRow = await screen.findByRole('button', {name: en.deleteOrder});

        fireEvent.click(deleteRow);

        expect(onDeleteOrder).toHaveBeenCalledTimes(1);
    });

    // Proves no confirmation step remains anywhere in this screen for either
    // removed popover (delete-order, confirm-order) — fails if a
    // modal.confirm, Popconfirm or any other Yes/No gate is reintroduced.
    // confirmDeleteOrder/confirmProceedToPayment were those popovers' only
    // consumers and are gone from the translations now, so this checks for
    // the shared yes/no strings instead of a since-deleted key.
    it('deleting the order leaves no Yes/No confirmation in the document', async () => {
        renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.moreActions}));
        fireEvent.click(await screen.findByRole('button', {name: en.deleteOrder}));

        expect(screen.queryByText(en.yes)).not.toBeInTheDocument();
        expect(screen.queryByText(en.no)).not.toBeInTheDocument();
    });

    it('closes from the close button', () => {
        const {onClose} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.close}));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    // The sheet keeps the order in local state and publishes its own edits
    // only to the dashboard's ref, so every new `order` the dashboard hands it
    // came from outside: the offline drain's refetch, the customer change,
    // the product sheet's add. It used to take one only when the item count
    // or customer changed, so an update at the same count never reached an
    // open sheet.
    describe('when the order changes outside the open sheet', () => {
        const kettle = (overrides) => item({
            sku: 'KETTLE', sku_name: 'Kettle', article: 'EK-1700', quantity: '1',
            price: '119.50', effective_price: '119.50', line_total: '119.50', ...overrides,
        });
        // A line the offline queue added: an id the server never issued.
        const QUEUED = {...ORDER, total: '299.30', items: [item(), kettle({id: 'tmp_k1', _pending: true})]};
        // The drain's refetch once that add has landed: the same two lines.
        const LANDED = {...QUEUED, items: [item(), kettle({id: 7})]};
        const quantityOf = (index) => screen.getAllByRole('textbox', {name: en.quantity})[index];

        it('drops the pending marker once a queued add lands, at the same item count', () => {
            const {rerender} = renderSheet({order: QUEUED});
            expect(screen.getByText(en.offlineItemPending)).toBeInTheDocument();

            rerender({order: LANDED});

            expect(screen.queryByText(en.offlineItemPending)).toBeNull();
            expect(screen.getAllByText('Kettle')).toHaveLength(1);
        });

        it('shows the server quantity again once the refetch after a parked line edit drops it', async () => {
            const order = {...ORDER, items: [item(), kettle({id: 2})]};
            // The sheet's own edit, answered from the offline queue.
            orderService.updateOrderItem.mockResolvedValue({
                success: true, status: null, offline: true,
                data: {...order, items: [item({quantity: '3', _pending: true}), kettle({id: 2})]},
            });
            const {rerender} = renderSheet({order});
            fireEvent.click(screen.getAllByRole('button', {name: en.increaseQuantity})[0]);
            await waitFor(() => expect(quantityOf(0)).toHaveValue('3'));
            expect(orderService.updateOrderItem).toHaveBeenCalledWith(42, 1, {quantity: 3});

            // The queue parked the edit, and the drain's refetch lays only
            // the ops still queued back over the server's order: the
            // dashboard now holds an order without it. (When the drain could
            // not read the order back, the re-read after Discard brings the
            // same order here instead.)
            rerender({order: {...order, items: [item(), kettle({id: 2})]}});

            expect(quantityOf(0)).toHaveValue('2');
            expect(screen.queryByText(en.offlineItemPending)).toBeNull();
        });

        it('shows the server delivery type again once the refetch after a parked order edit drops it, on the same step', async () => {
            orderService.updateOrder.mockResolvedValue({
                success: true, status: null, offline: true, data: {...ORDER, delivery_type: 'delivery'},
            });
            const {rerender} = renderSheet();
            fireEvent.click(screen.getByRole('button', {name: en.nextStep}));
            fireEvent.click(screen.getByRole('radio', {name: en.delivery}));
            expect(await screen.findByRole('textbox', {name: en.deliveryAddress})).toBeInTheDocument();

            rerender({order: {...ORDER, delivery_type: 'pickup'}});

            expect(screen.queryByRole('textbox', {name: en.deliveryAddress})).toBeNull();
            expect(screen.getByRole('dialog', {name: en.stepDelivery})).toBeInTheDocument();
        });

        it('keeps an edit it answered itself when the dashboard re-renders with the order it still holds', async () => {
            // The dashboard never hears of the sheet's edits (they only reach
            // its ref), so its `order` stays the one from before the edit.
            orderService.updateOrderItem.mockResolvedValue({
                success: true, data: {...ORDER, items: [item({quantity: '3'}), ORDER.items[1], ORDER.items[2]]},
            });
            const {rerender} = renderSheet();
            fireEvent.click(screen.getAllByRole('button', {name: en.increaseQuantity})[0]);
            await waitFor(() => expect(quantityOf(0)).toHaveValue('4'));

            rerender({confirmDisabled: true});

            expect(quantityOf(0)).toHaveValue('4');
        });

        it('lets a quantity change in flight land on top of an outside update, without remounting the row', async () => {
            let answer;
            orderService.updateOrderItem.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
            const {rerender} = renderSheet({order: QUEUED});
            fireEvent.click(screen.getAllByRole('button', {name: en.increaseQuantity})[0]);
            expect(quantityOf(0)).toBeDisabled();

            rerender({order: LANDED});

            expect(screen.queryByText(en.offlineItemPending)).toBeNull();
            // Still the same row, still waiting on its own request.
            expect(quantityOf(0)).toBeDisabled();

            answer({success: true, data: {...LANDED, items: [item({quantity: '3'}), kettle({id: 7})]}});
            await waitFor(() => expect(quantityOf(0)).not.toBeDisabled());
            expect(quantityOf(0)).toHaveValue('3');
        });

        it('keeps an open price editor and its typed value through an outside update', async () => {
            const auth = {authData: {...AUTH.authData, user: {can_apply_discount: true, max_discount_percent: '20'}}};
            const saved = {...LANDED, items: [item({discounted_price: '80.00', effective_price: '80.00'}), kettle({id: 7})]};
            orderService.updateOrderItem.mockResolvedValue({success: true, data: saved});
            const {rerender, onOrderUpdate} = renderSheet({auth, order: QUEUED});
            const priceButton = screen.getByRole('button', {name: `${en.overridePrice}: 89.90 ₾`});
            fireEvent.click(priceButton);
            fireEvent.change(screen.getByRole('textbox', {name: en.price}), {target: {value: '80'}});

            rerender({order: LANDED});

            expect(priceButton).toHaveAttribute('aria-expanded', 'true');
            const price = screen.getByRole('textbox', {name: en.price});
            expect(price).toHaveValue('80');
            fireEvent.blur(price);
            expect(orderService.updateOrderItem).toHaveBeenCalledWith(42, 1, {discounted_price: 80, discount_percent: 0});
            await waitFor(() => expect(onOrderUpdate).toHaveBeenCalledWith(saved));
        });

        it('keeps a comment still being typed through an outside update, and saves it after', async () => {
            const changed = {...ORDER, customer_name: 'Nino Kapanadze', external_client_id: 'C-9'};
            orderService.updateOrder.mockResolvedValue({success: true, data: {...changed, notes: 'Call first'}});
            const {rerender} = renderSheet();
            fireEvent.click(screen.getByRole('button', {name: en.nextStep}));
            fireEvent.change(screen.getByRole('textbox', {name: en.orderNotes}), {target: {value: 'Call first'}});

            // The customer changed from the ⋯ menu before the comment saved.
            rerender({order: changed});

            const delivery = screen.getByRole('dialog', {name: en.stepDelivery});
            expect(within(delivery).getAllByText('Nino Kapanadze').length).toBeGreaterThan(0);
            const notes = screen.getByRole('textbox', {name: en.orderNotes});
            expect(notes).toHaveValue('Call first');

            fireEvent.blur(notes);
            expect(orderService.updateOrder).toHaveBeenCalledWith(42, {notes: 'Call first'});
            await waitFor(() => expect(orderService.updateOrder).toHaveBeenCalledTimes(1));
            expect(screen.getByRole('textbox', {name: en.orderNotes})).toHaveValue('Call first');
        });

        it('starts another order on the cart step', () => {
            const {rerender} = renderSheet();
            fireEvent.click(screen.getByRole('button', {name: en.nextStep}));

            rerender({order: {...ORDER, id: 43, customer_name: 'Nino Kapanadze'}});

            const cart = screen.getByRole('dialog', {name: en.cart});
            expect(within(cart).getByRole('button', {name: /Nino Kapanadze/})).toBeInTheDocument();
        });

        // An offline scan's placeholder: the barcode stands in for the SKU,
        // and with no warehouse known yet it lists under a heading of its
        // own. Where the drain lands it is another section and another row
        // key, so taking that order mounts the row afresh — and React drops
        // the blur that would have saved what was typed in the old one.
        describe('while a cart field is being typed in', () => {
            const scanned = {
                id: 'tmp_s1', sku: '4860001234567', sku_name: '', price: 0, quantity: 1,
                effective_price: '0.00', line_total: '0.00', _pending: true, _barcodeOnly: true,
            };
            const SCANNED = {...ORDER, total: '179.80', items: [item(), scanned]};
            const SCAN_LANDED = {...ORDER, items: [item(), kettle({id: 7})]};
            const focus = (element) => act(() => element.focus());
            const leave = (element) => act(() => element.blur());

            it('holds a landed scan back until the typed quantity is saved', async () => {
                orderService.updateOrderItem.mockResolvedValue({
                    success: true, data: {...SCAN_LANDED, items: [item(), kettle({id: 7, quantity: '12'})]},
                });
                const {rerender} = renderSheet({order: SCANNED});
                const typed = quantityOf(1);
                focus(typed);
                fireEvent.change(typed, {target: {value: '12'}});

                rerender({order: SCAN_LANDED});

                expect(typed).toBeInTheDocument();
                expect(typed).toHaveValue('12');

                leave(typed);
                expect(orderService.updateOrderItem).toHaveBeenCalledWith(42, 'tmp_s1', {quantity: 12});
                expect(screen.queryByText(en.offlineItemPending)).toBeNull();
                await waitFor(() => expect(quantityOf(1)).toHaveValue('12'));
                expect(screen.getByRole('region', {name: 'Vake'})).toHaveTextContent('Kettle');
            });

            it('holds a landed scan back until the typed price is saved', async () => {
                const auth = {authData: {...AUTH.authData, user: {can_apply_discount: true, max_discount_percent: '20'}}};
                const saved = {...SCAN_LANDED, items: [item(), kettle({id: 7, discounted_price: '25.00', effective_price: '25.00'})]};
                orderService.updateOrderItem.mockResolvedValue({success: true, data: saved});
                const {rerender, onOrderUpdate} = renderSheet({auth, order: SCANNED});
                fireEvent.click(screen.getByRole('button', {name: `${en.overridePrice}: 0.00 ₾`}));
                const price = screen.getByRole('textbox', {name: en.price});
                focus(price);
                fireEvent.change(price, {target: {value: '25'}});

                rerender({order: SCAN_LANDED});

                expect(price).toBeInTheDocument();
                expect(price).toHaveValue('25');

                leave(price);
                expect(orderService.updateOrderItem).toHaveBeenCalledWith(
                    42, 'tmp_s1', {discounted_price: 25, discount_percent: 0},
                );
                await waitFor(() => expect(onOrderUpdate).toHaveBeenCalledWith(saved));
            });

            it('keeps holding while focus moves to another cart field', () => {
                const {rerender} = renderSheet({order: SCANNED});
                focus(quantityOf(1));

                rerender({order: SCAN_LANDED});
                focus(quantityOf(0));

                expect(screen.getByText(en.offlineItemPending)).toBeInTheDocument();
            });

            it('lets go of a held order when the step changes under the focused field', () => {
                const {rerender} = renderSheet({order: SCANNED});
                focus(quantityOf(1));

                rerender({order: SCAN_LANDED});
                // A tap on a button leaves the field focused on iOS: the
                // field goes with the cart, and no blur is ever seen.
                fireEvent.click(screen.getByRole('button', {name: en.nextStep}));
                fireEvent.click(screen.getByRole('button', {name: en.back}));

                expect(screen.queryByText(en.offlineItemPending)).toBeNull();
                expect(screen.getAllByText('Kettle')).toHaveLength(1);
            });

            // The dashboard's ref takes whichever order comes last, and the
            // sheet shows what it holds: an answer of the sheet's own that
            // lands after the outside order must not be undone by it.
            it('lets its own answer replace a held order, as the dashboard ref does', async () => {
                const order = {...ORDER, items: [item(), kettle({id: 2})]};
                let answer;
                orderService.updateOrderItem.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
                const {rerender} = renderSheet({order});
                fireEvent.click(screen.getAllByRole('button', {name: en.increaseQuantity})[0]);
                const typing = quantityOf(1);
                focus(typing);

                rerender({order: {...order, items: [item(), kettle({id: 2})]}});
                answer({success: true, data: {...order, items: [item({quantity: '3'}), kettle({id: 2})]}});
                await waitFor(() => expect(quantityOf(0)).toHaveValue('3'));

                leave(typing);
                expect(quantityOf(0)).toHaveValue('3');
            });
        });
    });
});

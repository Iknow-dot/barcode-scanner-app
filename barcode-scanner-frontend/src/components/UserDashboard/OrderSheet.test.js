import React from 'react';
import {render, screen, fireEvent, waitFor, within} from '@testing-library/react';
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
    productService: {searchProduct: jest.fn()},
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

const renderSheet = (props = {}) => {
    const handlers = {
        onClose: jest.fn(),
        onOrderUpdate: jest.fn(),
        onSaveForLater: jest.fn(),
        onProceedToPayment: jest.fn(),
        onDeleteOrder: jest.fn(),
        onChangeCustomer: jest.fn(),
        notify: {error: jest.fn()},
    };
    render(
        <AuthContext.Provider value={AUTH}>
            <LanguageProvider>
                <OrderSheet open order={ORDER} confirmDisabled={false} {...handlers} {...props}/>
            </LanguageProvider>
        </AuthContext.Provider>
    );
    return handlers;
};

describe('OrderSheet', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
        jest.clearAllMocks();
        // Stock lookups stay pending unless a test answers them, so no state
        // update lands after a test has finished.
        productService.searchProduct.mockImplementation(() => new Promise(() => {}));
    });

    afterEach(() => {
        localStorage.removeItem('language');
    });

    it('opens on the cart step with the client and products by warehouse', async () => {
        productService.searchProduct.mockResolvedValue({
            success: true,
            data: {stock: [{warehouse: 'W1', quantity: '9'}]},
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
        expect(productService.searchProduct).toHaveBeenCalledTimes(2);
        expect(productService.searchProduct).toHaveBeenCalledWith({
            sku: 'MG-2814', searchType: 'article', warehouseCodes: [], includeImages: false,
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
});

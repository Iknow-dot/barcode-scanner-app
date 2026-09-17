import React from 'react';
import {render, screen, fireEvent, waitFor, within} from '@testing-library/react';
import OrderSheet from './OrderSheet';
import AuthContext from '../Auth/AuthContext';
import {productService} from '../../api';
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

// jsdom lacks these browser APIs that antd's Drawer, Dropdown and Modal touch.
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

    it('confirms the order from the delivery step after asking', async () => {
        const {onProceedToPayment} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.nextStep}));
        expect(screen.getByText(en.total)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: en.confirmOrder}));
        expect(await screen.findByText(en.confirmProceedToPayment)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: en.yes}));
        await waitFor(() => expect(onProceedToPayment).toHaveBeenCalledTimes(1));
    });

    it('cannot confirm while offline or with unsynced changes', () => {
        renderSheet({confirmDisabled: true});
        fireEvent.click(screen.getByRole('button', {name: en.nextStep}));
        expect(screen.getByRole('button', {name: en.confirmOrder})).toBeDisabled();
    });

    it('saves the order for later from the ⋯ menu', async () => {
        const {onSaveForLater} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.moreActions}));
        fireEvent.click(await screen.findByRole('menuitem', {name: new RegExp(en.saveForLater)}));
        expect(onSaveForLater).toHaveBeenCalledTimes(1);
    });

    it('changes the customer from the ⋯ menu', async () => {
        const {onChangeCustomer} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.moreActions}));
        fireEvent.click(await screen.findByRole('menuitem', {name: new RegExp(en.changeCustomer)}));
        expect(onChangeCustomer).toHaveBeenCalledTimes(1);
    });

    it('deletes the order from the ⋯ menu only after confirming', async () => {
        const {onDeleteOrder} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.moreActions}));
        fireEvent.click(await screen.findByRole('menuitem', {name: new RegExp(en.deleteOrder)}));
        const confirm = await screen.findByRole('dialog', {name: en.confirmDeleteOrder});
        expect(onDeleteOrder).not.toHaveBeenCalled();
        fireEvent.click(within(confirm).getByRole('button', {name: en.yes}));
        await waitFor(() => expect(onDeleteOrder).toHaveBeenCalledTimes(1));
    });

    it('closes from the close button', () => {
        const {onClose} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.close}));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

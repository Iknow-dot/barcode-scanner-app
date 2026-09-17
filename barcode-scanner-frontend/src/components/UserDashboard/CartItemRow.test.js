import React from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import CartItemRow from './CartItemRow';
import {cartSections} from './cartSheetView';
import {orderService} from '../../api';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';

jest.mock('../../api', () => ({
    orderService: {
        updateOrderItem: jest.fn(),
        removeOrderItem: jest.fn(),
        addOrderItem: jest.fn(),
    },
}));

const en = translations.en;

// jsdom lacks these browser APIs that antd's Popconfirm and InputNumber touch.
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

const line = (overrides) => ({
    id: 11,
    sku: 'PAN',
    sku_name: 'Granite pan',
    article: 'MG-2814',
    warehouse_code: 'W1',
    warehouse_name: 'Vake',
    quantity: '2',
    price: '89.90',
    effective_price: '89.90',
    discount_percent: '0.00',
    discounted_price: null,
    line_total: '179.80',
    is_gift: false,
    unit: 'piece',
    ...overrides,
});

const rowFor = (items) => cartSections(items)[0].rows[0];
const UPDATED = {id: 7, items: []};

const renderRow = (props = {}) => {
    const handlers = {onOrderUpdate: jest.fn(), notify: {error: jest.fn()}};
    render(
        <LanguageProvider>
            <CartItemRow
                row={rowFor([line()])}
                stock={5}
                orderId={7}
                canApplyDiscount={false}
                maxDiscountPercent={0}
                giftEnabled
                {...handlers}
                {...props}
            />
        </LanguageProvider>
    );
    return handlers;
};

describe('CartItemRow', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
        jest.clearAllMocks();
        orderService.updateOrderItem.mockResolvedValue({success: true, data: UPDATED});
        orderService.removeOrderItem.mockResolvedValue({success: true, data: UPDATED});
    });

    afterEach(() => {
        localStorage.removeItem('language');
    });

    it('shows the product, its line total, unit price and stock', () => {
        renderRow();
        expect(screen.getByText('Granite pan')).toBeInTheDocument();
        expect(screen.getByText('179.80 ₾')).toBeInTheDocument();
        expect(screen.getByText('89.90 ₾ / Piece')).toBeInTheDocument();
        expect(screen.getByText(`${en.stockRemaining}: 5`)).toBeInTheDocument();
    });

    it('changes the quantity through the paid line', async () => {
        const {onOrderUpdate} = renderRow();
        fireEvent.click(screen.getByRole('button', {name: en.increaseQuantity}));
        await waitFor(() => expect(onOrderUpdate).toHaveBeenCalledWith(UPDATED));
        expect(orderService.updateOrderItem).toHaveBeenCalledWith(7, 11, {quantity: 3});
    });

    it('turns minus into delete at one paid unit', () => {
        renderRow({row: rowFor([line({quantity: '1', line_total: '89.90'})])});
        expect(screen.queryByRole('button', {name: en.decreaseQuantity})).toBeNull();
        expect(screen.getByRole('button', {name: en.delete})).toBeInTheDocument();
    });

    it('keeps minus, not delete, above the minimum', () => {
        renderRow();
        expect(screen.getByRole('button', {name: en.decreaseQuantity})).not.toBeDisabled();
        expect(screen.queryByRole('button', {name: en.delete})).toBeNull();
    });

    it('marks the row as a gift through the gift pill', async () => {
        const {onOrderUpdate} = renderRow({row: rowFor([line({quantity: '1', line_total: '89.90'})])});
        fireEvent.click(screen.getByRole('button', {name: en.giftLabel}));
        await waitFor(() => expect(onOrderUpdate).toHaveBeenCalledWith(UPDATED));
        expect(orderService.updateOrderItem).toHaveBeenCalledWith(7, 11, {is_gift: true});
    });

    it('has no gift pill when the org has gifts off', () => {
        renderRow({giftEnabled: false});
        expect(screen.queryByRole('button', {name: en.giftLabel})).toBeNull();
    });

    it('deletes both lines of the row after confirming', async () => {
        const row = rowFor([line({quantity: '1', line_total: '89.90'}), line({id: 12, quantity: '1', is_gift: true, line_total: '0.00'})]);
        const {onOrderUpdate} = renderRow({row});
        fireEvent.click(screen.getByRole('button', {name: en.delete}));
        fireEvent.click(await screen.findByRole('button', {name: en.yes}));
        await waitFor(() => expect(onOrderUpdate).toHaveBeenCalledWith(UPDATED));
        expect(orderService.removeOrderItem).toHaveBeenCalledWith(7, 11);
        expect(orderService.removeOrderItem).toHaveBeenCalledWith(7, 12);
    });

    it('offers no price editor to a user who may not discount', () => {
        renderRow({canApplyDiscount: false});
        expect(screen.queryByRole('button', {name: new RegExp(en.overridePrice)})).toBeNull();
        expect(screen.queryByRole('spinbutton')).toBeNull();
    });

    it('lets a user who may discount override the price', async () => {
        const {onOrderUpdate} = renderRow({canApplyDiscount: true, maxDiscountPercent: 20});
        fireEvent.click(screen.getByRole('button', {name: new RegExp(en.overridePrice)}));
        const price = screen.getByRole('spinbutton', {name: en.price});
        fireEvent.change(price, {target: {value: '80'}});
        fireEvent.blur(price);
        await waitFor(() => expect(onOrderUpdate).toHaveBeenCalledWith(UPDATED));
        expect(orderService.updateOrderItem).toHaveBeenCalledWith(7, 11, {discounted_price: 80, discount_percent: 0});
    });

    it('lets a user who may discount set a percent, and skips an unchanged field', async () => {
        const {onOrderUpdate} = renderRow({canApplyDiscount: true, maxDiscountPercent: 20});
        fireEvent.click(screen.getByRole('button', {name: new RegExp(en.overridePrice)}));
        fireEvent.blur(screen.getByRole('spinbutton', {name: en.price}));
        expect(orderService.updateOrderItem).not.toHaveBeenCalled();
        const discount = screen.getByRole('spinbutton', {name: en.discountPercent});
        fireEvent.change(discount, {target: {value: '10'}});
        fireEvent.blur(discount);
        await waitFor(() => expect(onOrderUpdate).toHaveBeenCalledWith(UPDATED));
        expect(orderService.updateOrderItem).toHaveBeenCalledWith(7, 11, {discount_percent: 10, discounted_price: null});
    });

    it('warns in words when the row exceeds the warehouse stock', () => {
        renderRow({stock: 1});
        expect(screen.getByText(en.exceedsStock(1))).toBeInTheDocument();
    });

    it('marks a line still waiting to sync', () => {
        renderRow({row: rowFor([line({id: 'tmp_x1', _pending: true})]), stock: undefined});
        expect(screen.getByText(en.offlineItemPending)).toBeInTheDocument();
    });

    it('reports a failed change', async () => {
        orderService.updateOrderItem.mockResolvedValue({success: false, error: 'nope'});
        const {notify, onOrderUpdate} = renderRow();
        fireEvent.click(screen.getByRole('button', {name: en.increaseQuantity}));
        await waitFor(() => expect(notify.error).toHaveBeenCalledWith(en.orderError, 'nope'));
        expect(onOrderUpdate).not.toHaveBeenCalled();
    });
});

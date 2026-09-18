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

    it('deletes the row on a single tap, with no confirmation step', async () => {
        // F4: delete only ever shows at totalQty === 1, so a row that still
        // pairs a paid and a gift line (totalQty >= 2, see below) can no
        // longer reach it — this exercises the one id it removes here.
        //
        // This fails if a Popconfirm (or any other confirm step) is
        // reintroduced: the click would only open a confirmation surface
        // rather than calling removeOrderItem, so the waitFor below would
        // time out, and a Yes/No affordance would be present to find.
        const {onOrderUpdate} = renderRow({row: rowFor([line({quantity: '1', line_total: '89.90'})])});
        fireEvent.click(screen.getByRole('button', {name: en.delete}));
        expect(screen.queryByRole('button', {name: en.yes})).toBeNull();
        expect(screen.queryByRole('button', {name: en.no})).toBeNull();
        expect(screen.queryByText(en.confirmDelete)).toBeNull();
        await waitFor(() => expect(onOrderUpdate).toHaveBeenCalledWith(UPDATED));
        expect(orderService.removeOrderItem).toHaveBeenCalledWith(7, 11);
    });

    it('disables delete while a removal is in flight, guarding against a double tap', async () => {
        // Fails if handleRemove is wired without runBusy (or if the button's
        // disabled prop is dropped): the button would stay enabled after the
        // first click, so the second fireEvent.click would fire a second
        // removeOrderItem call, and the call-count assertion below would see
        // 2 instead of 1.
        let resolveRemove;
        orderService.removeOrderItem.mockReturnValue(new Promise((resolve) => { resolveRemove = resolve; }));
        renderRow({row: rowFor([line({quantity: '1', line_total: '89.90'})])});
        const del = screen.getByRole('button', {name: en.delete});

        fireEvent.click(del);
        expect(del).toBeDisabled();
        // A disabled button does not receive a second click; this only
        // proves the guard exists rather than relying on it.
        fireEvent.click(del);
        expect(orderService.removeOrderItem).toHaveBeenCalledTimes(1);

        resolveRemove({success: true, data: UPDATED});
        await waitFor(() => expect(del).not.toBeDisabled());
    });

    it('offers no price editor to a user who may not discount', () => {
        // Scoped by name: the quantity stepper's own text field (aria-label
        // "Quantity") is always present, so an unscoped `textbox` query
        // would find it regardless of the price editor and pass for the
        // wrong reason.
        renderRow({canApplyDiscount: false});
        expect(screen.queryByRole('button', {name: new RegExp(en.overridePrice)})).toBeNull();
        expect(screen.queryByRole('textbox', {name: en.price})).toBeNull();
        expect(screen.queryByRole('textbox', {name: en.discountPercent})).toBeNull();
    });

    it('lets a user who may discount override the price', async () => {
        const {onOrderUpdate} = renderRow({canApplyDiscount: true, maxDiscountPercent: 20});
        fireEvent.click(screen.getByRole('button', {name: new RegExp(en.overridePrice)}));
        const price = screen.getByRole('textbox', {name: en.price});
        fireEvent.change(price, {target: {value: '80'}});
        fireEvent.blur(price);
        await waitFor(() => expect(onOrderUpdate).toHaveBeenCalledWith(UPDATED));
        expect(orderService.updateOrderItem).toHaveBeenCalledWith(7, 11, {discounted_price: 80, discount_percent: 0});
    });

    it('lets a user who may discount set a percent, and skips an unchanged field', async () => {
        const {onOrderUpdate} = renderRow({canApplyDiscount: true, maxDiscountPercent: 20});
        fireEvent.click(screen.getByRole('button', {name: new RegExp(en.overridePrice)}));
        fireEvent.blur(screen.getByRole('textbox', {name: en.price}));
        expect(orderService.updateOrderItem).not.toHaveBeenCalled();
        const discount = screen.getByRole('textbox', {name: en.discountPercent});
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

    it('disables the stepper while a quantity change is in flight, and re-enables after', async () => {
        let resolveUpdate;
        orderService.updateOrderItem.mockReturnValue(new Promise((resolve) => { resolveUpdate = resolve; }));
        const {onOrderUpdate} = renderRow();
        const plus = screen.getByRole('button', {name: en.increaseQuantity});

        fireEvent.click(plus);
        expect(plus).toBeDisabled();
        // A disabled button does not receive a second click; this only
        // proves the guard exists rather than relying on it.
        fireEvent.click(plus);
        expect(orderService.updateOrderItem).toHaveBeenCalledTimes(1);

        resolveUpdate({success: true, data: UPDATED});
        await waitFor(() => expect(onOrderUpdate).toHaveBeenCalledWith(UPDATED));
        expect(plus).not.toBeDisabled();
    });

    it('disables the gift pill while a gift change is in flight, and re-enables after', async () => {
        let resolveUpdate;
        orderService.updateOrderItem.mockReturnValue(new Promise((resolve) => { resolveUpdate = resolve; }));
        renderRow({row: rowFor([line({quantity: '1', line_total: '89.90'})])});
        const gift = screen.getByRole('button', {name: en.giftLabel});

        fireEvent.click(gift);
        expect(gift).toBeDisabled();

        resolveUpdate({success: true, data: UPDATED});
        await waitFor(() => expect(gift).not.toBeDisabled());
    });

    it('shows a disabled minus, not delete, when the minimum still holds a gift unit', () => {
        const row = rowFor([
            line({quantity: '1', line_total: '89.90'}),
            line({id: 12, quantity: '1', is_gift: true, line_total: '0.00'}),
        ]);
        renderRow({row});
        expect(screen.queryByRole('button', {name: en.delete})).toBeNull();
        expect(screen.getByRole('button', {name: en.decreaseQuantity})).toBeDisabled();
    });
});

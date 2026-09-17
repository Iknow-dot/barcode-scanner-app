import React from 'react';
import {render, screen, fireEvent, waitFor, within} from '@testing-library/react';
import DeliveryStep from './DeliveryStep';
import {orderService} from '../../api';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';

jest.mock('../../api', () => ({
    orderService: {updateOrder: jest.fn()},
}));

const en = translations.en;

// jsdom lacks these browser APIs that antd's Segmented and pickers touch.
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

const ORDER = {
    id: 42,
    customer_name: 'Giorgi Beridze',
    delivery_type: 'pickup',
    recipient_is_different: false,
    notes: '',
    items: [
        {id: 1, sku: 'PAN', warehouse_name: 'Vake', quantity: '2'},
        {id: 2, sku: 'KETTLE', warehouse_name: 'Vake', quantity: '1'},
        {id: 3, sku: 'PAN', warehouse_name: 'Central', quantity: '1', is_gift: true},
    ],
};
const UPDATED = {...ORDER, notes: 'x'};

const renderStep = (order = ORDER) => {
    const handlers = {onOrderUpdate: jest.fn(), notify: {error: jest.fn()}};
    const {container} = render(
        <LanguageProvider>
            <DeliveryStep order={order} {...handlers}/>
        </LanguageProvider>
    );
    return {...handlers, container};
};

describe('DeliveryStep', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
        jest.clearAllMocks();
        orderService.updateOrder.mockResolvedValue({success: true, data: UPDATED});
    });

    afterEach(() => {
        localStorage.removeItem('language');
    });

    it('switches between pickup and delivery', async () => {
        const {onOrderUpdate} = renderStep();
        fireEvent.click(screen.getByRole('radio', {name: en.delivery}));
        await waitFor(() => expect(onOrderUpdate).toHaveBeenCalledWith(UPDATED));
        expect(orderService.updateOrder).toHaveBeenCalledWith(42, {delivery_type: 'delivery'});
    });

    it('asks for address, date, time and delivery notes only for a delivery', () => {
        renderStep();
        expect(screen.queryByRole('textbox', {name: en.deliveryAddress})).toBeNull();
        expect(screen.queryByRole('textbox', {name: en.deliveryDate})).toBeNull();
        expect(screen.queryByRole('textbox', {name: en.deliveryTimeFrom})).toBeNull();
        expect(screen.queryByRole('textbox', {name: en.deliveryTimeTo})).toBeNull();
        expect(screen.queryByRole('textbox', {name: en.deliveryNotes})).toBeNull();
        expect(screen.getByRole('textbox', {name: en.orderNotes})).toBeInTheDocument();
    });

    it('shows the delivery fields with their saved values', () => {
        renderStep({
            ...ORDER,
            delivery_type: 'delivery',
            delivery_address: 'Vazha-Pshavela Ave 45',
            delivery_date: '2026-09-16',
            delivery_time_from: '12:00:00',
            delivery_time_to: '15:00:00',
        });
        expect(screen.getByRole('textbox', {name: en.deliveryAddress})).toHaveValue('Vazha-Pshavela Ave 45');
        expect(screen.getByRole('textbox', {name: en.deliveryDate})).toHaveValue('2026-09-16');
        expect(screen.getByRole('textbox', {name: en.deliveryTimeFrom})).toHaveValue('12:00');
        expect(screen.getByRole('textbox', {name: en.deliveryTimeTo})).toHaveValue('15:00');
        expect(screen.getByRole('textbox', {name: en.deliveryNotes})).toBeInTheDocument();
    });

    it('saves the comment when the field is left', async () => {
        const {onOrderUpdate} = renderStep();
        const comment = screen.getByRole('textbox', {name: en.orderNotes});
        fireEvent.change(comment, {target: {value: 'Call first'}});
        fireEvent.blur(comment);
        await waitFor(() => expect(onOrderUpdate).toHaveBeenCalledWith(UPDATED));
        expect(orderService.updateOrder).toHaveBeenCalledWith(42, {notes: 'Call first'});
    });

    it('clears the other recipient when switching back to the same one', async () => {
        renderStep({...ORDER, recipient_is_different: true, recipient_first_name: 'Nino'});
        expect(screen.getByRole('textbox', {name: en.firstName})).toHaveValue('Nino');
        fireEvent.click(screen.getByRole('radio', {name: en.recipientSame}));
        await waitFor(() => expect(orderService.updateOrder).toHaveBeenCalledWith(42, {
            recipient_is_different: false,
            recipient_first_name: '',
            recipient_last_name: '',
            recipient_phone: '',
        }));
    });

    it('shows the customer as the contact when the recipient is the same', () => {
        const {container} = renderStep({...ORDER, customer_phone: '555123456'});
        const contact = container.querySelector('.m-recipient-contact');
        expect(within(contact).getByText('Giorgi Beridze')).toBeInTheDocument();
        expect(within(contact).getByText('555123456')).toBeInTheDocument();
    });

    it('flags an invalid recipient phone in words', () => {
        renderStep({...ORDER, recipient_is_different: true, recipient_phone: '12345'});
        expect(screen.getByRole('alert')).toHaveTextContent(en.phoneInvalid);
    });

    it('summarizes the client, warehouses and quantity', () => {
        renderStep();
        const summary = screen.getByRole('heading', {name: en.orderSummary}).nextElementSibling;
        expect(within(summary).getByText('Giorgi Beridze')).toBeInTheDocument();
        expect(within(summary).getByText('Vake, Central')).toBeInTheDocument();
        expect(within(summary).getByText(en.piecesCount(4))).toBeInTheDocument();
    });

    it('reports a failed save', async () => {
        orderService.updateOrder.mockResolvedValue({success: false, error: 'nope'});
        const {notify} = renderStep();
        fireEvent.click(screen.getByRole('radio', {name: en.delivery}));
        await waitFor(() => expect(notify.error).toHaveBeenCalledWith(en.orderError, 'nope'));
    });
});

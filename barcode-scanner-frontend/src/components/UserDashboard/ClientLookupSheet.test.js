import React from 'react';
import {render, screen, fireEvent, act} from '@testing-library/react';
import ClientLookupSheet from './ClientLookupSheet';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';
import {clientService} from '../../api';

const en = translations.en;

jest.mock('../../api', () => ({
    clientService: {
        checkClient: jest.fn(),
    },
}));

// ClientCreateForm (the create step) pulls in AddressMapPicker, which pulls
// in react-leaflet — an ESM-only package nothing in this suite exercises and
// that CRA's jest transform can't parse. Stub the map picker so requiring
// ClientLookupSheet doesn't require react-leaflet; ClientCreateForm.test.js
// covers the create step's own behaviour.
jest.mock('./AddressMapPicker', () => function AddressMapPickerStub() {
    return null;
});

// jsdom lacks these browser APIs that antd's Drawer/Segmented touch.
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

const CLIENT_A = {name: 'გიორგი ბერიძე', identification_number: '123456789', phone: '599112233', address: 'ვაჟა-ფშაველას პრ. 45'};
const CLIENT_B = {name: 'ანა ბერიძე', identification_number: '010080345', phone: '599881240', address: 'ჭავჭავაძის ქ. 12'};
const CLIENT_C = {name: 'დავით ბერიძე', identification_number: '350010567', phone: '577456789', address: 'რუსთაველის ქ. 8'};

const renderSheet = (props = {}) => {
    const handlers = {onSelect: jest.fn(), onClose: jest.fn()};
    const utils = render(
        <LanguageProvider>
            <ClientLookupSheet open {...handlers} {...props}/>
        </LanguageProvider>
    );
    return {...handlers, ...utils};
};

const idInput = () => screen.getByPlaceholderText(en.lookupIdPlaceholder);
const phoneInput = () => screen.getByPlaceholderText(en.lookupPhonePlaceholder);
const nameInput = () => screen.getByPlaceholderText(en.lookupNamePlaceholder);
const phoneTab = () => screen.getByRole('radio', {name: en.lookupByPhoneTab});
const nameTab = () => screen.getByRole('radio', {name: en.lookupByNameTab});

const flushDebounce = async (ms = 1500) => {
    await act(async () => {
        jest.advanceTimersByTime(ms);
        await Promise.resolve();
        await Promise.resolve();
    });
};

describe('ClientLookupSheet', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        localStorage.setItem('language', 'en');
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.useRealTimers();
        localStorage.removeItem('language');
    });

    it('switching tabs clears the field and results', async () => {
        clientService.checkClient.mockResolvedValue({success: true, data: {clients: [CLIENT_A, CLIENT_B, CLIENT_C]}});
        renderSheet();

        fireEvent.change(idInput(), {target: {value: '123456789'}});
        await flushDebounce();
        expect(screen.getByText(CLIENT_A.name)).toBeInTheDocument();

        fireEvent.click(phoneTab());
        expect(phoneInput()).toHaveValue('');
        expect(screen.queryByText(CLIENT_A.name)).toBeNull();
    });

    it('fires one checkClient({identification_number}) 1500ms after the id reaches 9 digits', async () => {
        clientService.checkClient.mockResolvedValue({success: true, data: {clients: []}});
        renderSheet();

        fireEvent.change(idInput(), {target: {value: '123456789'}});
        await act(async () => {
            jest.advanceTimersByTime(1499);
        });
        expect(clientService.checkClient).not.toHaveBeenCalled();

        await flushDebounce(1);
        expect(clientService.checkClient).toHaveBeenCalledTimes(1);
        expect(clientService.checkClient).toHaveBeenCalledWith({identification_number: '123456789'});
    });

    it('searches again when the field is cleared and the same value is retyped', async () => {
        clientService.checkClient.mockResolvedValue({success: true, data: {clients: []}});
        renderSheet();

        fireEvent.change(idInput(), {target: {value: '123456789'}});
        await flushDebounce();
        expect(clientService.checkClient).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', {name: en.clearSearch}));
        expect(idInput()).toHaveValue('');

        fireEvent.change(idInput(), {target: {value: '123456789'}});
        await flushDebounce();
        expect(clientService.checkClient).toHaveBeenCalledTimes(2);
    });

    it('searches again for the same value after switching to another tab and back', async () => {
        clientService.checkClient.mockResolvedValue({success: true, data: {clients: []}});
        renderSheet();

        fireEvent.change(idInput(), {target: {value: '123456789'}});
        await flushDebounce();
        expect(clientService.checkClient).toHaveBeenCalledTimes(1);

        fireEvent.click(phoneTab());
        fireEvent.click(screen.getByRole('radio', {name: en.lookupByIdTab}));
        expect(idInput()).toHaveValue('');

        fireEvent.change(idInput(), {target: {value: '123456789'}});
        await flushDebounce();
        expect(clientService.checkClient).toHaveBeenCalledTimes(2);
    });

    it('does not search after the sheet closes with a pending debounce timer', async () => {
        clientService.checkClient.mockResolvedValue({success: true, data: {clients: []}});
        const {rerender} = renderSheet();

        fireEvent.change(idInput(), {target: {value: '123456789'}});
        // Close before the 1500ms debounce elapses.
        rerender(
            <LanguageProvider>
                <ClientLookupSheet open={false} onSelect={jest.fn()} onClose={jest.fn()}/>
            </LanguageProvider>
        );

        await flushDebounce();
        expect(clientService.checkClient).not.toHaveBeenCalled();
    });

    it('fires nothing for 8 digits', async () => {
        renderSheet();

        fireEvent.change(idInput(), {target: {value: '12345678'}});
        await flushDebounce();
        expect(clientService.checkClient).not.toHaveBeenCalled();
    });

    it('does not auto-search the name tab on a pause, but searches on submit', async () => {
        clientService.checkClient.mockResolvedValue({success: true, data: {clients: []}});
        renderSheet();
        fireEvent.click(nameTab());

        fireEvent.change(nameInput(), {target: {value: 'ბერ'}});
        await flushDebounce();
        expect(clientService.checkClient).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', {name: en.searchAction}));
        await act(async () => {
            await Promise.resolve();
        });
        expect(clientService.checkClient).toHaveBeenCalledWith({name: 'ბერ'});
    });

    it('selects the single match automatically and renders no list', async () => {
        clientService.checkClient.mockResolvedValue({success: true, data: {clients: [CLIENT_A]}});
        const {onSelect} = renderSheet();

        fireEvent.change(idInput(), {target: {value: '123456789'}});
        await flushDebounce();

        expect(onSelect).toHaveBeenCalledWith(CLIENT_A);
        expect(screen.queryByText(CLIENT_A.name)).toBeNull();
    });

    it('renders three rows for three matches and selects the tapped one', async () => {
        clientService.checkClient.mockResolvedValue({success: true, data: {clients: [CLIENT_A, CLIENT_B, CLIENT_C]}});
        const {onSelect} = renderSheet();

        fireEvent.change(idInput(), {target: {value: '123456789'}});
        await flushDebounce();

        expect(screen.getByText(CLIENT_A.name)).toBeInTheDocument();
        expect(screen.getByText(CLIENT_B.name)).toBeInTheDocument();
        expect(screen.getByText(CLIENT_C.name)).toBeInTheDocument();
        expect(screen.getByText('3 clients')).toBeInTheDocument();

        fireEvent.click(screen.getByText(CLIENT_B.name));
        expect(onSelect).toHaveBeenCalledWith(CLIENT_B);
    });

    it('moves to the create step with the not-found banner on CLIENT_NOT_FOUND', async () => {
        clientService.checkClient.mockResolvedValue({success: false, code: 'CLIENT_NOT_FOUND'});
        renderSheet();

        fireEvent.change(idInput(), {target: {value: '123456789'}});
        await flushDebounce();

        expect(screen.getByRole('dialog', {name: en.createCustomer})).toBeInTheDocument();
        expect(screen.getByText(en.clientNotFoundCreate)).toBeInTheDocument();
    });

    it('moves to the create step without the banner when the create row is tapped', () => {
        renderSheet();

        fireEvent.click(screen.getByText(en.createClientRow));

        expect(screen.getByRole('dialog', {name: en.createCustomer})).toBeInTheDocument();
        expect(screen.queryByText(en.clientNotFoundCreate)).toBeNull();
    });

    it('renders no retail button when onRetail is absent', () => {
        renderSheet();
        expect(screen.queryByText(en.continueWithoutClient)).toBeNull();
    });

    it('renders a retail button that calls onRetail when provided', () => {
        const onRetail = jest.fn();
        renderSheet({onRetail});

        fireEvent.click(screen.getByText(en.continueWithoutClient));
        expect(onRetail).toHaveBeenCalledTimes(1);
    });
});

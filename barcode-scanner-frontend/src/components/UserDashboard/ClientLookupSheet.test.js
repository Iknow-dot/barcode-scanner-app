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
        createClient: jest.fn(),
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

    it('renders no save action on the lookup step', () => {
        renderSheet();
        expect(screen.queryByRole('button', {name: en.save})).toBeNull();
    });

    it('renders the create form inside the sheet and saves via the navbar action', async () => {
        clientService.createClient.mockResolvedValue({success: true, data: {name: 'Giorgi Beridze'}});
        const {onSelect} = renderSheet();

        fireEvent.click(screen.getByText(en.createClientRow));

        // ClientCreateForm's own fields, proving the sheet actually renders
        // it (not just a shell) and that this test reaches real form state,
        // not a directly-injected registerSubmit mock like
        // ClientCreateForm.test.js uses.
        const firstNameInput = screen.getByRole('textbox', {name: en.firstName});
        const lastNameInput = screen.getByRole('textbox', {name: en.lastName});
        fireEvent.change(firstNameInput, {target: {value: 'Giorgi'}});
        fireEvent.change(lastNameInput, {target: {value: 'Beridze'}});

        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: en.save}));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(clientService.createClient).toHaveBeenCalledWith(expect.objectContaining({
            first_name: 'Giorgi',
            last_name: 'Beridze',
        }));
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({name: 'Giorgi Beridze'}));
    });

    describe('A1: a pending search must not survive a jump to the create step', () => {
        it('does not call checkClient (or hijack onSelect) for a search left pending when the create row is tapped', async () => {
            clientService.checkClient.mockResolvedValue({success: true, data: {clients: [CLIENT_A]}});
            const {onSelect} = renderSheet();

            fireEvent.change(idInput(), {target: {value: '123456789'}});
            // Jump to the create step manually, before the 1500ms debounce
            // fires — the scenario is a consultant who already knows the
            // customer is new.
            fireEvent.click(screen.getByText(en.createClientRow));
            expect(screen.getByRole('dialog', {name: en.createCustomer})).toBeInTheDocument();

            await flushDebounce();

            expect(clientService.checkClient).not.toHaveBeenCalled();
            expect(onSelect).not.toHaveBeenCalled();
        });

        it('does not pop the not-found banner over the create form from that same stray search', async () => {
            clientService.checkClient.mockResolvedValue({success: false, code: 'CLIENT_NOT_FOUND'});
            renderSheet();

            fireEvent.change(idInput(), {target: {value: '123456789'}});
            fireEvent.click(screen.getByText(en.createClientRow));
            expect(screen.queryByText(en.clientNotFoundCreate)).toBeNull();

            await flushDebounce();

            expect(clientService.checkClient).not.toHaveBeenCalled();
            expect(screen.queryByText(en.clientNotFoundCreate)).toBeNull();
        });
    });

    describe('A2: in-flight state and a stale-response guard', () => {
        it('shows a spinner and marks the field busy while a search is in flight, then clears it', async () => {
            let resolveCheck;
            clientService.checkClient.mockReturnValue(new Promise((resolve) => { resolveCheck = resolve; }));
            renderSheet();
            fireEvent.click(nameTab());
            fireEvent.change(nameInput(), {target: {value: 'ბერიძე'}});

            fireEvent.click(screen.getByRole('button', {name: en.searchAction}));
            await act(async () => { await Promise.resolve(); });

            // antd's Drawer portals its content onto document.body rather
            // than RTL's own render container, so query from document.
            expect(document.querySelector('.if-search[aria-busy="true"]')).toBeInTheDocument();
            expect(document.querySelector('.if-spinner')).toBeInTheDocument();
            expect(screen.queryByRole('button', {name: en.searchAction})).toBeNull();

            await act(async () => {
                resolveCheck({success: true, data: {clients: []}});
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(document.querySelector('.if-spinner')).toBeNull();
        });

        it('discards an abandoned search that resolves after a newer one', async () => {
            let resolveFirst;
            let resolveSecond;
            clientService.checkClient.mockImplementation((args) => {
                if (args.identification_number === '123456789') {
                    return new Promise((resolve) => { resolveFirst = resolve; });
                }
                return new Promise((resolve) => { resolveSecond = resolve; });
            });
            const {onSelect} = renderSheet();

            // The ID tab has no manual search button — typing through 9 and
            // then 11 digits is exactly how two auto-fired searches overlap.
            fireEvent.change(idInput(), {target: {value: '123456789'}});
            await flushDebounce();
            expect(clientService.checkClient).toHaveBeenCalledTimes(1);

            fireEvent.change(idInput(), {target: {value: '12345678901'}});
            await flushDebounce();
            expect(clientService.checkClient).toHaveBeenCalledTimes(2);

            // The later query resolves first.
            await act(async () => {
                resolveSecond({success: true, data: {clients: [CLIENT_B]}});
                await Promise.resolve();
                await Promise.resolve();
            });
            expect(onSelect).toHaveBeenCalledWith(CLIENT_B);

            onSelect.mockClear();
            // The abandoned, earlier query resolves last — must be dropped,
            // not select CLIENT_A for a query the consultant edited away from.
            await act(async () => {
                resolveFirst({success: true, data: {clients: [CLIENT_A]}});
                await Promise.resolve();
                await Promise.resolve();
            });
            expect(onSelect).not.toHaveBeenCalled();
        });
    });

    describe('A3: the create form keeps what was typed across a back-then-create-again', () => {
        it('preserves typed fields after going back to the lookup step and tapping create again', async () => {
            clientService.checkClient.mockResolvedValue({success: false, code: 'CLIENT_NOT_FOUND'});
            renderSheet();

            fireEvent.change(idInput(), {target: {value: '123456789'}});
            await flushDebounce();
            expect(screen.getByRole('dialog', {name: en.createCustomer})).toBeInTheDocument();

            fireEvent.change(screen.getByRole('textbox', {name: en.firstName}), {target: {value: 'Giorgi'}});
            fireEvent.change(screen.getByRole('textbox', {name: en.lastName}), {target: {value: 'Beridze'}});
            fireEvent.change(screen.getByRole('textbox', {name: en.customerEmail}), {target: {value: 'giorgi@example.com'}});

            fireEvent.click(screen.getByRole('button', {name: en.back}));
            expect(screen.getByRole('dialog', {name: en.lookupClient})).toBeInTheDocument();

            fireEvent.click(screen.getByText(en.createClientRow));

            expect(screen.getByRole('textbox', {name: en.firstName})).toHaveValue('Giorgi');
            expect(screen.getByRole('textbox', {name: en.lastName})).toHaveValue('Beridze');
            expect(screen.getByRole('textbox', {name: en.customerEmail})).toHaveValue('giorgi@example.com');
        });

        it('resets to a new seed when a different search comes back not found', async () => {
            clientService.checkClient.mockResolvedValue({success: false, code: 'CLIENT_NOT_FOUND'});
            renderSheet();

            fireEvent.change(idInput(), {target: {value: '123456789'}});
            await flushDebounce();
            fireEvent.change(screen.getByRole('textbox', {name: en.firstName}), {target: {value: 'Giorgi'}});

            fireEvent.click(screen.getByRole('button', {name: en.back}));
            fireEvent.change(idInput(), {target: {value: '987654321'}});
            await flushDebounce();

            expect(screen.getByRole('dialog', {name: en.createCustomer})).toBeInTheDocument();
            expect(screen.getByRole('textbox', {name: en.firstName})).toHaveValue('');
            expect(screen.getByRole('textbox', {name: en.customerIdNumber})).toHaveValue('987654321');
        });
    });

    describe('A4: an inline hint for a value that is not yet searchable', () => {
        it('shows a hint under the id field below 9 digits, and clears it once searchable', async () => {
            renderSheet();

            fireEvent.change(idInput(), {target: {value: '12345678'}});
            expect(screen.getByText(en.lookupIdHint)).toBeInTheDocument();

            fireEvent.change(idInput(), {target: {value: '123456789'}});
            expect(screen.queryByText(en.lookupIdHint)).toBeNull();
        });

        it('shows a hint under the phone field for a non-mobile number', () => {
            renderSheet();
            fireEvent.click(phoneTab());

            fireEvent.change(phoneInput(), {target: {value: '499451230'}});
            expect(screen.getByText(en.lookupPhoneHint)).toBeInTheDocument();
        });

        it('shows a hint under the name field below 3 characters', () => {
            renderSheet();
            fireEvent.click(nameTab());

            fireEvent.change(nameInput(), {target: {value: 'ბ'}});
            expect(screen.getByText(en.lookupNameHint)).toBeInTheDocument();
        });

        it('shows no hint for an empty field', () => {
            renderSheet();
            expect(screen.queryByText(en.lookupIdHint)).toBeNull();
        });
    });
});

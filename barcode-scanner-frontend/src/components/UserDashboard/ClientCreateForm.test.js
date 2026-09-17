import React from 'react';
import {render, screen, fireEvent, act} from '@testing-library/react';
import {message} from 'antd';
import ClientCreateForm from './ClientCreateForm';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';
import {clientService} from '../../api';

const en = translations.en;

jest.mock('../../api', () => ({
    clientService: {
        createClient: jest.fn(),
        checkClient: jest.fn(),
        lookupRsGe: jest.fn(),
        searchAddresses: jest.fn(),
        reverseGeocode: jest.fn(),
    },
}));

// AddressMapPicker mounts a real Leaflet map, which nothing in this codebase
// exercises under jsdom yet; stub it so the form's own logic is what's
// under test.
jest.mock('./AddressMapPicker', () => function AddressMapPickerStub() {
    return <div data-testid="address-map-stub"/>;
});

// jsdom lacks these browser APIs that antd's Segmented touches.
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

const EMPTY_SEED = {identification_number: '', phone: '', first_name: '', last_name: ''};

const renderForm = (props = {}) => {
    const registerSubmit = jest.fn();
    const onCreated = jest.fn();
    const utils = render(
        <LanguageProvider>
            <ClientCreateForm
                seed={EMPTY_SEED}
                showNotFoundBanner={false}
                onCreated={onCreated}
                registerSubmit={registerSubmit}
                {...props}
            />
        </LanguageProvider>
    );
    return {...utils, registerSubmit, onCreated};
};

// registerSubmit is called on every render with the latest closure; the
// last call always has the freshest submit function.
const latestSubmit = (registerSubmit) => registerSubmit.mock.calls[registerSubmit.mock.calls.length - 1][0];

const submit = async (registerSubmit) => {
    await act(async () => {
        await latestSubmit(registerSubmit)();
    });
};

describe('ClientCreateForm', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
        jest.clearAllMocks();
    });

    afterEach(async () => {
        localStorage.removeItem('language');
        // antd's message toasts render into a static holder in document.body,
        // outside the React tree RTL unmounts between tests — clear them so
        // an earlier test's toast can't satisfy a later getByText.
        await act(async () => {
            message.destroy();
        });
    });

    it('hands the sheet a submit function via registerSubmit', () => {
        const {registerSubmit} = renderForm();
        expect(registerSubmit).toHaveBeenCalled();
        expect(typeof latestSubmit(registerSubmit)).toBe('function');
    });

    it('requires first and last name, and nothing else', async () => {
        const {registerSubmit, onCreated} = renderForm();

        await submit(registerSubmit);

        expect(screen.getByText(en.firstNameRequired)).toBeInTheDocument();
        expect(screen.getByText(en.lastNameRequired)).toBeInTheDocument();
        expect(clientService.createClient).not.toHaveBeenCalled();
        expect(onCreated).not.toHaveBeenCalled();
    });

    it('creates with only first and last name filled in', async () => {
        clientService.createClient.mockResolvedValue({success: true, data: {name: 'Giorgi Beridze'}});
        const {registerSubmit, onCreated} = renderForm();

        fireEvent.change(screen.getByRole('textbox', {name: en.firstName}), {target: {value: 'Giorgi'}});
        fireEvent.change(screen.getByRole('textbox', {name: en.lastName}), {target: {value: 'Beridze'}});
        await submit(registerSubmit);

        expect(clientService.createClient).toHaveBeenCalledWith({
            first_name: 'Giorgi',
            last_name: 'Beridze',
            identification_number: '',
            is_phys: true,
            phone: '',
            phone_2: '',
            email: '',
            address_line: '',
        });
        expect(onCreated).toHaveBeenCalled();
    });

    describe('RS.ge lookup', () => {
        it('warns when the identification number is empty', async () => {
            renderForm();

            fireEvent.click(screen.getByRole('button', {name: en.lookupFromRsGe}));
            await act(async () => { await Promise.resolve(); });

            expect(screen.getByText(en.customerIdNumberRequired)).toBeInTheDocument();
            expect(clientService.lookupRsGe).not.toHaveBeenCalled();
        });

        it('fills both names from the response', async () => {
            clientService.lookupRsGe.mockResolvedValue({success: true, data: {first_name: 'Nino', last_name: 'Kapanadze'}});
            renderForm({seed: {...EMPTY_SEED, identification_number: '12345678901'}});

            fireEvent.click(screen.getByRole('button', {name: en.lookupFromRsGe}));
            await act(async () => { await Promise.resolve(); });

            expect(clientService.lookupRsGe).toHaveBeenCalledWith('12345678901');
            expect(screen.getByRole('textbox', {name: en.firstName})).toHaveValue('Nino');
            expect(screen.getByRole('textbox', {name: en.lastName})).toHaveValue('Kapanadze');
            expect(screen.getByText(en.rsGeFound)).toBeInTheDocument();
        });

        it('leaves an omitted name untouched', async () => {
            clientService.lookupRsGe.mockResolvedValue({success: true, data: {first_name: 'Nino'}});
            renderForm({seed: {...EMPTY_SEED, identification_number: '12345678901', first_name: '', last_name: 'Existing'}});

            fireEvent.click(screen.getByRole('button', {name: en.lookupFromRsGe}));
            await act(async () => { await Promise.resolve(); });

            expect(screen.getByRole('textbox', {name: en.firstName})).toHaveValue('Nino');
            expect(screen.getByRole('textbox', {name: en.lastName})).toHaveValue('Existing');
        });

        it('shows rsGeNotFound for RS_GE_NOT_FOUND', async () => {
            clientService.lookupRsGe.mockResolvedValue({success: false, code: 'RS_GE_NOT_FOUND'});
            renderForm({seed: {...EMPTY_SEED, identification_number: '12345678901'}});

            fireEvent.click(screen.getByRole('button', {name: en.lookupFromRsGe}));
            await act(async () => { await Promise.resolve(); });

            expect(screen.getByText(en.rsGeNotFound)).toBeInTheDocument();
        });

        it('shows rsGeTimeout for RS_GE_TIMEOUT', async () => {
            clientService.lookupRsGe.mockResolvedValue({success: false, code: 'RS_GE_TIMEOUT'});
            renderForm({seed: {...EMPTY_SEED, identification_number: '12345678901'}});

            fireEvent.click(screen.getByRole('button', {name: en.lookupFromRsGe}));
            await act(async () => { await Promise.resolve(); });

            expect(screen.getByText(en.rsGeTimeout)).toBeInTheDocument();
        });

        it('shows rsGeError for anything else', async () => {
            clientService.lookupRsGe.mockResolvedValue({success: false, code: 'SOMETHING_ELSE'});
            renderForm({seed: {...EMPTY_SEED, identification_number: '12345678901'}});

            fireEvent.click(screen.getByRole('button', {name: en.lookupFromRsGe}));
            await act(async () => { await Promise.resolve(); });

            expect(screen.getByText(en.rsGeError)).toBeInTheDocument();
        });
    });

    describe('create with recovery', () => {
        const fillNames = () => {
            fireEvent.change(screen.getByRole('textbox', {name: en.firstName}), {target: {value: 'Giorgi'}});
            fireEvent.change(screen.getByRole('textbox', {name: en.lastName}), {target: {value: 'Beridze'}});
        };

        it('calls onCreated with upstream data folded over typed values on success', async () => {
            clientService.createClient.mockResolvedValue({
                success: true,
                data: {name: '', address: 'Vake', phone: ''},
            });
            const {registerSubmit, onCreated} = renderForm({
                seed: {...EMPTY_SEED, identification_number: '123', phone: '599112233'},
            });
            fillNames();

            await submit(registerSubmit);

            expect(onCreated).toHaveBeenCalledWith({
                name: 'Giorgi Beridze',
                address: 'Vake',
                phone: '599112233',
                identification_number: '123',
            });
            expect(screen.getByText(en.clientCreated)).toBeInTheDocument();
        });

        it('recovers an indeterminate failure and reports success when the client is found', async () => {
            clientService.createClient.mockResolvedValue({success: false, status: 500});
            clientService.checkClient.mockResolvedValue({
                success: true,
                data: {clients: [{name: 'Giorgi Beridze', identification_number: '123', phone: ''}]},
            });
            const {registerSubmit, onCreated} = renderForm({
                seed: {...EMPTY_SEED, identification_number: '123'},
            });
            fillNames();

            await submit(registerSubmit);

            expect(clientService.checkClient).toHaveBeenCalledWith({identification_number: '123', phone: ''});
            expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({
                name: 'Giorgi Beridze',
                identification_number: '123',
            }));
            expect(screen.getByText(en.clientCreated)).toBeInTheDocument();
        });

        it('warns clientCreateUnverified and does not call onCreated when recovery cannot tell', async () => {
            jest.useFakeTimers();
            clientService.createClient.mockResolvedValue({success: false, status: 500});
            clientService.checkClient.mockResolvedValue({success: false, status: 500});
            const {registerSubmit, onCreated} = renderForm({
                seed: {...EMPTY_SEED, identification_number: '123'},
            });
            fillNames();

            let submitPromise;
            act(() => {
                submitPromise = latestSubmit(registerSubmit)();
            });

            // Let createClient's mock resolve (indeterminate) and
            // recoverCreatedClient's first attempt (no delay) run.
            await act(async () => {
                await Promise.resolve();
                await Promise.resolve();
                await Promise.resolve();
            });
            // recoverCreatedClient waits CREATE_RECOVERY_RETRY_MS (2500ms)
            // before its second attempt.
            await act(async () => {
                jest.advanceTimersByTime(2500);
                await Promise.resolve();
                await Promise.resolve();
                await Promise.resolve();
            });
            await act(async () => {
                await submitPromise;
            });
            jest.useRealTimers();

            expect(screen.getByText(en.clientCreateUnverified)).toBeInTheDocument();
            expect(onCreated).not.toHaveBeenCalled();
        });

        it('shows the coded error message on a definite failure', async () => {
            clientService.createClient.mockResolvedValue({success: false, code: 'CLIENT_ALREADY_EXISTS'});
            const {registerSubmit, onCreated} = renderForm();
            fillNames();

            await submit(registerSubmit);

            expect(screen.getByText(en.clientAlreadyExists)).toBeInTheDocument();
            expect(onCreated).not.toHaveBeenCalled();
        });
    });
});

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

// registerSubmit is called on every render with the latest closure (and the
// current busy flag as a second argument); the last call is always freshest.
const latestSubmit = (registerSubmit) => registerSubmit.mock.calls[registerSubmit.mock.calls.length - 1][0];
const latestBusy = (registerSubmit) => registerSubmit.mock.calls[registerSubmit.mock.calls.length - 1][1];

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

    describe('double-submit guard', () => {
        const fillNames = () => {
            fireEvent.change(screen.getByRole('textbox', {name: en.firstName}), {target: {value: 'Giorgi'}});
            fireEvent.change(screen.getByRole('textbox', {name: en.lastName}), {target: {value: 'Beridze'}});
        };

        it('issues only one createClient call when tapped twice while a create is in flight', async () => {
            let resolveCreate;
            clientService.createClient.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
            const {registerSubmit, onCreated} = renderForm();
            fillNames();

            const submitFn = latestSubmit(registerSubmit);
            let firstPromise;
            act(() => {
                firstPromise = submitFn();
                // The second tap, synchronously, before the first call's
                // createClient promise has had a chance to settle.
                submitFn();
            });

            expect(clientService.createClient).toHaveBeenCalledTimes(1);

            await act(async () => {
                resolveCreate({success: true, data: {name: 'Giorgi Beridze'}});
                await firstPromise;
            });

            expect(onCreated).toHaveBeenCalledTimes(1);
        });

        it('is busy while creating and enabled again after a success', async () => {
            let resolveCreate;
            clientService.createClient.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
            const {registerSubmit} = renderForm();
            fillNames();

            let submitPromise;
            act(() => {
                submitPromise = latestSubmit(registerSubmit)();
            });
            expect(latestBusy(registerSubmit)).toBe(true);

            await act(async () => {
                resolveCreate({success: true, data: {name: 'Giorgi Beridze'}});
                await submitPromise;
            });
            expect(latestBusy(registerSubmit)).toBe(false);
        });

        it('is enabled again after a failed create', async () => {
            clientService.createClient.mockResolvedValue({success: false, code: 'CLIENT_ALREADY_EXISTS'});
            const {registerSubmit} = renderForm();
            fillNames();

            await submit(registerSubmit);

            expect(latestBusy(registerSubmit)).toBe(false);
        });

        // B1: the assertion above only pins the React `submitting` state, not
        // `submittingRef` — the ref read synchronously inside handleSubmit
        // that actually gates a second concurrent, non-idempotent
        // createClient call. Prove the ref itself cleared, by submitting
        // again and checking a second call actually goes out.
        it('does not wedge shut after a failed create — a second submit fires a second call', async () => {
            clientService.createClient.mockResolvedValue({success: false, code: 'CLIENT_ALREADY_EXISTS'});
            const {registerSubmit} = renderForm();
            fillNames();

            await submit(registerSubmit);
            expect(clientService.createClient).toHaveBeenCalledTimes(1);

            await submit(registerSubmit);
            expect(clientService.createClient).toHaveBeenCalledTimes(2);
        });
    });

    describe('B3: field labels are programmatically associated', () => {
        it('pairs each label with its field via for/id', () => {
            renderForm();

            const firstNameInput = screen.getByRole('textbox', {name: en.firstName});
            const label = screen.getByText(en.firstName);
            expect(label.tagName).toBe('LABEL');
            expect(label).toHaveAttribute('for', firstNameInput.id);
            expect(firstNameInput.id).toBeTruthy();
        });

        it('marks an invalid field with aria-invalid and ties it to the error via aria-describedby', async () => {
            const {registerSubmit} = renderForm();

            await submit(registerSubmit);

            const firstNameInput = screen.getByRole('textbox', {name: en.firstName});
            expect(firstNameInput).toHaveAttribute('aria-invalid', 'true');
            const describedBy = firstNameInput.getAttribute('aria-describedby');
            expect(describedBy).toBeTruthy();
            expect(document.getElementById(describedBy)).toHaveTextContent(en.firstNameRequired);
        });
    });

    describe('B2: the keyboard return/Go key saves', () => {
        it('wraps the fields in a form wired to the submit handler, with a real submit control for the browser\'s implicit-submit-on-Enter behaviour', async () => {
            clientService.createClient.mockResolvedValue({success: true, data: {name: 'Giorgi Beridze'}});
            const {container, onCreated} = renderForm();

            fireEvent.change(screen.getByRole('textbox', {name: en.firstName}), {target: {value: 'Giorgi'}});
            fireEvent.change(screen.getByRole('textbox', {name: en.lastName}), {target: {value: 'Beridze'}});

            const form = container.querySelector('form');
            expect(form).toBeTruthy();
            // A real (if invisible) submit control — with several text
            // fields and none, most browsers won't implicitly submit on
            // Enter at all.
            expect(form.querySelector('button[type="submit"]')).toBeTruthy();

            // jsdom does not replicate the browser's native
            // Enter-submits-a-form behaviour for synthetic key events, so
            // the wiring itself is what's under test here: the same 'submit'
            // event a real Enter keypress fires against the form the fields
            // and the hidden button both live in.
            await act(async () => {
                fireEvent.submit(form);
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(clientService.createClient).toHaveBeenCalledWith(expect.objectContaining({
                first_name: 'Giorgi',
                last_name: 'Beridze',
            }));
            expect(onCreated).toHaveBeenCalled();
        });

        it('restores the addressSearching spinner suffix and hint text once the debounced search fires', async () => {
            jest.useFakeTimers();
            let resolveSearch;
            clientService.searchAddresses.mockReturnValue(new Promise((resolve) => { resolveSearch = resolve; }));
            const {container} = renderForm();

            fireEvent.change(screen.getByPlaceholderText(en.addressLine), {target: {value: 'Vake'}});
            await act(async () => {
                jest.advanceTimersByTime(300);
            });

            // The modal's LoadingOutlined suffix and notFoundContent text
            // were both dropped in the port (B2) — both are back, driven by
            // the same addressSearching flag.
            expect(container.querySelector('.if-spinner')).toBeInTheDocument();
            expect(screen.getByText(en.addressSearching)).toBeInTheDocument();

            await act(async () => {
                resolveSearch({success: true, data: {suggestions: []}});
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(container.querySelector('.if-spinner')).toBeNull();
            jest.useRealTimers();
        });
    });

    describe('address search after unmount', () => {
        // React 18 silently no-ops a state update on an already-unmounted
        // component (no console warning), so the guard can't be observed
        // through React's own diagnostics. Instead, prove the early return
        // actually happens: the response's `data` is defined via a getter
        // with a side effect, so it is provably never read when the guard
        // (correctly) drops the response before touching it.
        it('drops a search response that resolves after the component has unmounted', async () => {
            jest.useFakeTimers();
            const dataAccessed = jest.fn();
            let resolveSearch;
            const pending = new Promise((resolve) => {
                resolveSearch = () => resolve({
                    success: true,
                    get data() {
                        dataAccessed();
                        return {suggestions: [{label: 'Vake, Tbilisi', lat: 1, lng: 2}]};
                    },
                });
            });
            clientService.searchAddresses.mockReturnValue(pending);
            const {unmount} = renderForm();

            fireEvent.change(screen.getByPlaceholderText(en.addressLine), {target: {value: 'Vake'}});
            await act(async () => {
                jest.advanceTimersByTime(300);
            });
            expect(clientService.searchAddresses).toHaveBeenCalledWith('Vake');

            // This component can genuinely unmount mid-search — the sheet
            // closing, or a fresh search landing on a different seed and
            // remounting a clean instance.
            unmount();

            await act(async () => {
                resolveSearch();
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(dataAccessed).not.toHaveBeenCalled();
            jest.useRealTimers();
        });
    });
});

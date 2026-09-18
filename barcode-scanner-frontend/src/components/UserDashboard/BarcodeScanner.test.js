import React from 'react';
import {render, screen, fireEvent, waitFor, act} from '@testing-library/react';
import BarcodeScanner from './BarcodeScanner';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';

const en = translations.en;

// The exact mock shape the brief carries: a shared `start`/`stop` across every
// `Html5Qrcode` instance the component constructs, so tests can flip their
// behaviour per-call with mockResolvedValueOnce/mockRejectedValueOnce.
//
// CRA's jest config sets `resetMocks: true` (create-react-app's
// createJestConfig.js), which calls jest.resetAllMocks() before *every*
// test — including the first. That wipes any .mockImplementation() set here
// at module-eval time, so `Html5Qrcode` itself (not just `start`/`stop`)
// must be re-armed in beforeEach below, or `new Html5Qrcode(...)` silently
// falls back to an empty default instance and every test fails with
// "scanner.start is not a function".
jest.mock('html5-qrcode', () => {
    const Html5Qrcode = jest.fn();
    return {
        __mock: {
            start: jest.fn(),
            stop: jest.fn(),
            getRunningTrackCameraCapabilities: jest.fn(),
            Html5Qrcode,
        },
        Html5QrcodeScannerState: {NOT_STARTED: 1, SCANNING: 2, PAUSED: 3},
        Html5Qrcode,
    };
});

// eslint-disable-next-line import/first
import {__mock} from 'html5-qrcode';

const renderScanner = (props = {}) => {
    const handlers = {onScan: jest.fn(), onClose: jest.fn()};
    const utils = render(
        <LanguageProvider>
            <BarcodeScanner open {...handlers} {...props}/>
        </LanguageProvider>
    );
    return {...utils, ...handlers};
};

describe('BarcodeScanner', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
        // resetMocks wipes every mock's implementation before each test
        // (see the comment on jest.mock above) — all four are re-armed here,
        // including Html5Qrcode itself, not just start/stop.
        __mock.start.mockImplementation(() => Promise.resolve());
        __mock.stop.mockImplementation(() => Promise.resolve());
        __mock.getRunningTrackCameraCapabilities.mockImplementation(() => ({
            torchFeature: () => ({isSupported: () => false}),
        }));
        __mock.Html5Qrcode.mockImplementation(() => ({
            start: __mock.start,
            stop: __mock.stop,
            getState: () => 2,
            getRunningTrackCameraCapabilities: __mock.getRunningTrackCameraCapabilities,
        }));
    });

    afterEach(() => {
        localStorage.removeItem('language');
        jest.useRealTimers();
    });

    // Would fail against the old implementation, which awaited a bare
    // `setTimeout(resolve, 100)` before ever touching the camera: with fake
    // timers armed and never advanced, that await would hang forever and
    // `start` would never be called. Reading the container via ref needs no
    // timer at all, so `start` fires within the same synchronous effect
    // flush that mounts the component.
    it('starts the camera exactly once, synchronously, with no artificial delay', async () => {
        jest.useFakeTimers();
        const {rerender} = renderScanner();

        expect(__mock.start).toHaveBeenCalledTimes(1);

        // A re-render with a brand new onScan reference must not restart the
        // camera — the effect's deps (startScanner/stopScanner) are stable
        // useCallbacks, and onScan reaches the running scan only through a
        // ref that this re-render alone must not disturb.
        rerender(
            <LanguageProvider>
                <BarcodeScanner open onScan={() => {}} onClose={() => {}}/>
            </LanguageProvider>
        );
        expect(__mock.start).toHaveBeenCalledTimes(1);

        // Let the pending start() promise settle inside act() before the
        // test ends, so no state update lands outside of it.
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
    });

    it('stops the camera when closed', async () => {
        const {rerender} = renderScanner();
        await waitFor(() => expect(__mock.start).toHaveBeenCalledTimes(1));

        rerender(
            <LanguageProvider>
                <BarcodeScanner open={false} onScan={() => {}} onClose={() => {}}/>
            </LanguageProvider>
        );

        await waitFor(() => expect(__mock.stop).toHaveBeenCalled());
        // A closed scanner renders nothing — the overlay, and the camera
        // element the library was writing frames into, are both gone.
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('renders the classified message for a start rejection and retries into a working camera', async () => {
        __mock.start.mockImplementationOnce(() =>
            Promise.reject({name: 'NotReadableError', message: 'Device is busy'})
        );
        renderScanner();

        expect(await screen.findByText(en.cameraBusy)).toBeInTheDocument();
        expect(screen.getByText('Device is busy')).toBeInTheDocument();
        const retryButton = screen.getByRole('button', {name: en.retry});

        fireEvent.click(retryButton);

        await waitFor(() => expect(__mock.start).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.queryByText(en.cameraBusy)).toBeNull());
        expect(screen.queryByRole('button', {name: en.retry})).toBeNull();
    });

    it('offers no retry for a denied permission', async () => {
        __mock.start.mockImplementationOnce(() =>
            Promise.reject({name: 'NotAllowedError', message: 'Permission denied'})
        );
        renderScanner();

        expect(await screen.findByText(en.cameraPermissionDenied)).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: en.retry})).toBeNull();
    });

    it('calls onScan once for the first decode even when the library fires the callback again', async () => {
        __mock.start.mockImplementationOnce((cameraIdOrConfig, config, onSuccess) => {
            onSuccess('4860112028140');
            onSuccess('4860112028140');
            return Promise.resolve();
        });
        const {onScan} = renderScanner();

        await waitFor(() => expect(onScan).toHaveBeenCalledTimes(1));
        expect(onScan).toHaveBeenCalledWith('4860112028140');
    });

    it('has no manual-search pill without the prop', async () => {
        renderScanner();
        await waitFor(() => expect(__mock.start).toHaveBeenCalledTimes(1));
        expect(screen.queryByRole('button', {name: en.manualSearch})).toBeNull();
    });

    it('renders the manual-search pill only when supplied, and it calls the handler', async () => {
        const onManualSearch = jest.fn();
        renderScanner({onManualSearch});
        await waitFor(() => expect(__mock.start).toHaveBeenCalledTimes(1));

        const pill = screen.getByRole('button', {name: en.manualSearch});
        fireEvent.click(pill);
        expect(onManualSearch).toHaveBeenCalledTimes(1);
    });

    it('closes from the close button', async () => {
        const {onClose} = renderScanner();
        await waitFor(() => expect(__mock.start).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole('button', {name: en.close}));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('shows the torch control only once the running track reports it, and toggles it', async () => {
        const enable = jest.fn(() => Promise.resolve());
        const disable = jest.fn(() => Promise.resolve());
        __mock.getRunningTrackCameraCapabilities.mockImplementation(() => ({
            torchFeature: () => ({isSupported: () => true, enable, disable}),
        }));
        renderScanner();

        const torchButton = await screen.findByTestId('scanner-torch-btn');
        fireEvent.click(torchButton);
        await waitFor(() => expect(enable).toHaveBeenCalledTimes(1));

        fireEvent.click(torchButton);
        await waitFor(() => expect(disable).toHaveBeenCalledTimes(1));
    });

    it('keeps the flip control even when the canvas omits it, and it restarts the camera facing the other way', async () => {
        renderScanner();
        await waitFor(() => expect(__mock.start).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByTestId('scanner-flip-btn'));

        await waitFor(() => expect(__mock.start).toHaveBeenCalledTimes(2));
        expect(__mock.start.mock.calls[1][0]).toEqual({facingMode: 'user'});
    });
});

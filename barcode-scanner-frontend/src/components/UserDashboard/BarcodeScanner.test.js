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
//
// F3(b): the enum values are deliberately NOT the library's real 1/2/3.
// `BarcodeScanner.js`'s `isActiveScanState` is supposed to compare against
// the imported `Html5QrcodeScannerState` constants rather than hardcoded
// literals — if it were ever reverted to `state === 2 || state === 3`, these
// non-standard values would make every active-state check fail silently,
// which would show up as `.stop()` never being called anywhere in this file.
jest.mock('html5-qrcode', () => {
    const Html5Qrcode = jest.fn();
    return {
        __mock: {
            start: jest.fn(),
            stop: jest.fn(),
            getRunningTrackCameraCapabilities: jest.fn(),
            Html5Qrcode,
        },
        Html5QrcodeScannerState: {NOT_STARTED: 41, SCANNING: 47, PAUSED: 48},
        Html5Qrcode,
    };
});

// eslint-disable-next-line import/first
import {__mock, Html5QrcodeScannerState} from 'html5-qrcode';

// F3(a): the library's real transaction semantics (read out of
// node_modules/html5-qrcode/esm/html5-qrcode.js:109-263 and
// esm/state-manager.js:13-32), modelled per-instance rather than the flat
// `getState: () => 2` the previous mock used everywhere:
//   - `getState()` reports NOT_STARTED for the whole of a pending `start()`
//     (the transition to SCANNING is only *executed*, flipping the state,
//     once the camera has actually come up) and SCANNING from then on.
//   - `getState()` keeps reporting SCANNING for the *entire* async `stop()`
//     teardown, including while it is still in flight — the transition to
//     NOT_STARTED is likewise only executed once `stop()`'s promise settles.
//   - a second `stop()` call while one is already in flight throws
//     synchronously, matching `StateManagerImpl.startTransition`'s
//     `failIfTransitionOngoing()`.
// A flat mock hides exactly the bug this file exists to catch: with a
// constant SCANNING, `startScanner`'s own "clean up the previous instance"
// `stop()` call never behaves differently from a fresh one, which happens to
// resync the microtask ordering the regression depends on. See the
// "camera lifecycle" describe block below.
const liveHtml5QrcodeInstances = [];
const createRealisticHtml5QrcodeInstance = () => {
    let started = false;
    let stopping = false;
    const instance = {
        start: (...args) => __mock.start(...args).then(
            (result) => {
                started = true;
                return result;
            },
            (error) => {
                started = false;
                throw error;
            }
        ),
        stop: (...args) => {
            const state = instance.getState();
            if (state !== Html5QrcodeScannerState.SCANNING && state !== Html5QrcodeScannerState.PAUSED) {
                throw new Error('Cannot stop, scanner is not running or paused.');
            }
            if (stopping) {
                throw new Error('Cannot transition to a new state, already under transition');
            }
            stopping = true;
            return __mock.stop(...args).then(
                (result) => {
                    stopping = false;
                    started = false;
                    return result;
                },
                (error) => {
                    stopping = false;
                    throw error;
                }
            );
        },
        getState: () => {
            if (stopping) return Html5QrcodeScannerState.SCANNING;
            return started ? Html5QrcodeScannerState.SCANNING : Html5QrcodeScannerState.NOT_STARTED;
        },
        getRunningTrackCameraCapabilities: __mock.getRunningTrackCameraCapabilities,
    };
    liveHtml5QrcodeInstances.push(instance);
    return instance;
};

// Number of constructed instances whose camera is, per the state machine
// above, still on (SCANNING — started, or mid-`stop()`) rather than fully
// torn down. This is the same accounting the whole-plan review's
// reproduction used ("live: [...]") to show the orphaned stream.
const liveInstanceCount = () => liveHtml5QrcodeInstances.filter(
    (instance) => instance.getState() !== Html5QrcodeScannerState.NOT_STARTED
).length;

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
        liveHtml5QrcodeInstances.length = 0;
        // resetMocks wipes every mock's implementation before each test
        // (see the comment on jest.mock above) — all four are re-armed here,
        // including Html5Qrcode itself, not just start/stop.
        __mock.start.mockImplementation(() => Promise.resolve());
        __mock.stop.mockImplementation(() => Promise.resolve());
        __mock.getRunningTrackCameraCapabilities.mockImplementation(() => ({
            torchFeature: () => ({isSupported: () => false}),
        }));
        __mock.Html5Qrcode.mockImplementation(() => createRealisticHtml5QrcodeInstance());
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

        // Exact count, not just toHaveBeenCalled(): closing calls the
        // component's own stopScanner twice (effect cleanup, then the
        // `else` branch re-running because `open` itself changed — see the
        // single effect in BarcodeScanner.js). Today that second call never
        // reaches the underlying library stop() — by the time it runs, the
        // ref is already cleared — so exactly one real stop() happens. A
        // regression that made the second call redundantly invoke stop()
        // again (or, worse, dropped the real one) would slip past a loose
        // toHaveBeenCalled() assertion.
        await waitFor(() => expect(__mock.stop).toHaveBeenCalledTimes(1));
        // A closed scanner renders nothing — the overlay, and the camera
        // element the library was writing frames into, are both gone.
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    // F1/F2: the whole-plan review's headline finding. The previous mock's
    // constant `getState` masked this — see the block comment above
    // `createRealisticHtml5QrcodeInstance`. Both tests below are RED against
    // the pre-fix BarcodeScanner.js (proven while building this suite) and
    // GREEN once stopScanner clears the ref before its own `await`, and
    // startScanner's generation token stops a start that was superseded
    // while it was still in flight.
    //
    // `flushAsync` settles every pending promise chain, however many `.then`
    // hops long, before asserting. A fixed number of `await Promise.resolve()`
    // hops or relying on `waitFor`'s own polling is not enough here: `waitFor`
    // evaluates its callback synchronously on the very first call, so an
    // assertion checked immediately after resolving a promise can observe a
    // *pre*-settlement snapshot and pass before the state it is meant to
    // check has actually been reached — a genuine "passes for the wrong
    // reason" trap this suite hit while being written (see F2's test below).
    // A macrotask boundary (setTimeout) is ordered after the *entire*
    // microtask queue drains, including microtasks that chained `.then`s
    // enqueue while draining, regardless of how deep the chain is.
    const flushAsync = () => act(() => new Promise((resolve) => {
        setTimeout(resolve, 0);
    }));

    describe('camera lifecycle', () => {
        it('flipping the camera leaves exactly one live instance running, and closing stops it', async () => {
            const {rerender} = renderScanner();
            await waitFor(() => expect(__mock.start).toHaveBeenCalledTimes(1));
            await flushAsync();
            expect(liveInstanceCount()).toBe(1);

            fireEvent.click(screen.getByRole('button', {name: en.flipCamera}));

            await waitFor(() => expect(__mock.start).toHaveBeenCalledTimes(2));
            await flushAsync();
            // The flip must settle on exactly one running camera — the new
            // instance — not zero (both torn down) and not two (the old one
            // orphaned alongside the new one).
            expect(liveInstanceCount()).toBe(1);

            rerender(
                <LanguageProvider>
                    <BarcodeScanner open={false} onScan={() => {}} onClose={() => {}}/>
                </LanguageProvider>
            );
            await flushAsync();

            // This is the regression: against the pre-fix code the ref that
            // `stopScanner` reads on close has already been wiped by the
            // flip, so the still-running instance is never told to stop and
            // this stays 1 instead of settling to 0.
            expect(liveInstanceCount()).toBe(0);
        });

        it('closing while the camera is still starting leaves nothing running once getUserMedia resolves', async () => {
            let resolveStart;
            __mock.start.mockImplementationOnce(
                () => new Promise((resolve) => {
                    resolveStart = resolve;
                })
            );
            const {rerender} = renderScanner();
            await waitFor(() => expect(__mock.start).toHaveBeenCalledTimes(1));

            // Close while start() is still pending — getState() reads
            // NOT_STARTED for the whole pending transition, so a stopScanner
            // that only stops what looks "active" has nothing to stop yet.
            rerender(
                <LanguageProvider>
                    <BarcodeScanner open={false} onScan={() => {}} onClose={() => {}}/>
                </LanguageProvider>
            );

            // getUserMedia "resolves" only now, after the close already ran.
            resolveStart();
            await flushAsync();

            // This is F2's regression: against the pre-fix code nothing
            // referenced this instance once the ref was nulled during the
            // close, so the now-started camera is never stopped and this
            // stays 1 instead of settling to 0. (Checked with a full async
            // flush rather than `waitFor`, precisely because `waitFor`'s
            // first, synchronous check here lands *before* resolveStart()'s
            // continuation has run and would otherwise see a coincidental,
            // not-yet-orphaned 0 and stop looking.)
            expect(liveInstanceCount()).toBe(0);
        });
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

    // F6: the viewfinder (animated scan line, corner brackets) and the
    // "point camera at a barcode" hint both imply a live feed. Rendering
    // them behind the error panel tells the consultant the scanner is
    // working at the exact moment it isn't. Would fail if the `!cameraError
    // &&` guards around either block in BarcodeScanner.js were removed.
    it('hides the viewfinder and the scan hint while a camera error is showing', async () => {
        __mock.start.mockImplementationOnce(() =>
            Promise.reject({name: 'NotReadableError', message: 'Device is busy'})
        );
        renderScanner();

        expect(await screen.findByText(en.cameraBusy)).toBeInTheDocument();
        expect(screen.queryByText(en.scanHint)).toBeNull();
        expect(document.querySelector('.viewfinder-box')).toBeNull();
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

        const torchButton = await screen.findByRole('button', {name: en.torchToggle});
        fireEvent.click(torchButton);
        await waitFor(() => expect(enable).toHaveBeenCalledTimes(1));

        fireEvent.click(torchButton);
        await waitFor(() => expect(disable).toHaveBeenCalledTimes(1));
    });

    // F1: the default mock's `isSupported: () => false` (armed in beforeEach)
    // means the torch capability was never granted — the button must not
    // render at all, not just be untested. Without the `torchAvailable &&`
    // guard in BarcodeScanner.js this fails because the button is present.
    it('has no torch control when the running track does not support it', async () => {
        renderScanner();
        await waitFor(() => expect(__mock.start).toHaveBeenCalledTimes(1));

        expect(screen.queryByRole('button', {name: en.torchToggle})).toBeNull();
        expect(screen.queryByTestId('scanner-torch-btn')).toBeNull();
    });

    it('keeps the flip control even when the canvas omits it, and it restarts the camera facing the other way', async () => {
        renderScanner();
        await waitFor(() => expect(__mock.start).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole('button', {name: en.flipCamera}));

        await waitFor(() => expect(__mock.start).toHaveBeenCalledTimes(2));
        expect(__mock.start.mock.calls[1][0]).toEqual({facingMode: 'user'});
    });

    // F3: aria-modal="true" is a promise that everything outside is inert.
    // The scanner is hand-rolled (no antd Drawer underneath), so it must earn
    // that promise itself: Escape closes it, focus moves onto the close
    // button on open, and focus is restored to whatever had it before the
    // scanner opened. A full focus trap is deliberately out of scope.
    it('moves focus to the close button when it opens', async () => {
        renderScanner();
        await waitFor(() => expect(screen.getByRole('button', {name: en.close})).toHaveFocus());
    });

    it('closes on Escape', async () => {
        const {onClose} = renderScanner();
        await waitFor(() => expect(__mock.start).toHaveBeenCalledTimes(1));

        fireEvent.keyDown(document, {key: 'Escape'});

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('restores focus to the previously focused element when it closes', async () => {
        const trigger = document.createElement('button');
        trigger.textContent = 'open scanner';
        document.body.appendChild(trigger);
        trigger.focus();
        expect(trigger).toHaveFocus();

        const {rerender} = renderScanner();
        await waitFor(() => expect(screen.getByRole('button', {name: en.close})).toHaveFocus());

        rerender(
            <LanguageProvider>
                <BarcodeScanner open={false} onScan={() => {}} onClose={() => {}}/>
            </LanguageProvider>
        );

        await waitFor(() => expect(trigger).toHaveFocus());
        document.body.removeChild(trigger);
    });
});

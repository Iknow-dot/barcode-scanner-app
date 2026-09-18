import React, {useEffect, useRef, useState, useCallback} from 'react';
import {Html5Qrcode, Html5QrcodeScannerState} from 'html5-qrcode';
import {BulbOutlined, BulbFilled, SwapOutlined} from '@ant-design/icons';
import {useLanguage} from '../../i18n/LanguageContext';
import {classifyCameraError} from './cameraError';
import IosIcon from '../Common/IosIcon';
import './BarcodeScanner.css';

const SCANNER_ELEMENT_ID = 'barcode-scanner-video';

// html5-qrcode's own state enum, imported rather than compared against the
// literals 2/3 — a library version bump renumbering these must not silently
// change the stop/start guards below.
const isActiveScanState = (state) =>
    state === Html5QrcodeScannerState.SCANNING || state === Html5QrcodeScannerState.PAUSED;

const BarcodeScanner = ({open, onScan, onClose, onManualSearch}) => {
    const {t} = useLanguage();
    const containerRef = useRef(null);
    const scannerRef = useRef(null);
    const hasScannedRef = useRef(false);
    const isStartingRef = useRef(false);
    // Generation token for the in-flight `start()` call (F2). Incremented by
    // both stopScanner and startScanner, so a start that is still awaiting
    // getUserMedia when a close (or a newer start) runs can tell, once it
    // resolves, that it has been superseded and must stop the camera itself
    // rather than leave it referenced by nothing.
    const startTokenRef = useRef(0);
    const closeButtonRef = useRef(null);
    // The element focused right before the scanner opened, so it can be
    // restored on close. Captured from `document.activeElement`, so it is
    // only ever as good as whatever the browser still reports focused at
    // that moment (see the focus-management effect below).
    const previouslyFocusedRef = useRef(null);
    const [torchOn, setTorchOn] = useState(false);
    const [torchAvailable, setTorchAvailable] = useState(false);
    const [facingMode, setFacingMode] = useState('environment');
    // classifyCameraError() result ({kind, messageKey, canRetry, detail}), or null
    const [cameraError, setCameraError] = useState(null);

    // Store onScan/onClose in refs so neither goes stale and neither causes
    // dependency-chain re-renders (the Escape-to-close effect below reads
    // onCloseRef instead of depending on `onClose` directly, so it isn't torn
    // down and rebuilt every time the parent re-renders while open).
    const onScanRef = useRef(onScan);
    useEffect(() => {
        onScanRef.current = onScan;
    }, [onScan]);

    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    const stopScanner = useCallback(async () => {
        isStartingRef.current = false;
        // F2: invalidate any start() that is still in flight — if it
        // resolves after this, it must not keep the camera it just turned
        // on referenced by nothing.
        startTokenRef.current += 1;
        // F1: take the instance and clear the ref synchronously, before any
        // await. html5-qrcode's stop() opens a transaction rather than
        // transitioning immediately — getState() keeps reporting the active
        // state for the whole async teardown — so on a flip, React runs this
        // cleanup and the new effect body's startScanner back to back before
        // either await settles. If the ref were cleared only after this
        // await (as it used to be), the continuation below would run *after*
        // startScanner has already replaced it with a new, running instance,
        // and this line would wipe the reference to that instance instead of
        // the one this call is actually stopping — orphaning a live camera.
        // Nulling first means no later continuation can wipe a newer one.
        const scanner = scannerRef.current;
        scannerRef.current = null;
        if (scanner) {
            try {
                if (isActiveScanState(scanner.getState())) {
                    await scanner.stop();
                }
            } catch (e) {
                // Ignore stop errors during cleanup
            }
        }
        setTorchOn(false);
        setTorchAvailable(false);
        setCameraError(null);
        hasScannedRef.current = false;
    }, []);

    const startScanner = useCallback(async (facing) => {
        // Prevent concurrent start attempts
        if (isStartingRef.current) return;
        isStartingRef.current = true;
        // F2: this call's generation. Checked again after the awaited
        // scanner.start() below — if stopScanner (or a newer startScanner)
        // ran in the meantime and bumped the counter, this call has been
        // superseded.
        const token = ++startTokenRef.current;

        // Ensure any previous instance is cleaned up (same ref-before-await
        // ordering as stopScanner, for the same reason — see its comment).
        const previousScanner = scannerRef.current;
        scannerRef.current = null;
        if (previousScanner) {
            try {
                if (isActiveScanState(previousScanner.getState())) {
                    await previousScanner.stop();
                }
            } catch (e) {
                // ignore
            }
        }

        hasScannedRef.current = false;
        setCameraError(null);

        // The video container only exists in the DOM while `open`, and it
        // mounts in the same commit this effect runs after, so the ref is
        // already attached here — no artificial delay needed. html5-qrcode's
        // constructor still wants an element *id* string rather than a node,
        // so the id is read off the ref'd element instead of reaching for
        // document.getElementById: a future restyle that reorders or delays
        // the markup can't silently leave this pointing at nothing.
        const element = containerRef.current;
        if (!element) {
            isStartingRef.current = false;
            return;
        }

        const scanner = new Html5Qrcode(element.id);
        scannerRef.current = scanner;

        try {
            await scanner.start(
                {facingMode: facing},
                {
                    fps: 15,
                    qrbox: (viewfinderWidth, viewfinderHeight) => {
                        const minDim = Math.min(viewfinderWidth, viewfinderHeight);
                        const size = Math.floor(minDim * 0.7);
                        return {width: Math.max(size, 200), height: Math.max(Math.floor(size * 0.5), 120)};
                    },
                    aspectRatio: window.innerWidth > window.innerHeight ? 16 / 9 : 9 / 16,
                    videoConstraints: {
                        facingMode: facing,
                        width: {ideal: 1920},
                        height: {ideal: 1080},
                    },
                },
                (decodedText) => {
                    if (!hasScannedRef.current) {
                        hasScannedRef.current = true;
                        // Use the ref so this callback never goes stale
                        onScanRef.current(decodedText);
                    }
                },
                () => {
                    // Scan error (no code found in frame) — ignore
                }
            );

            if (startTokenRef.current !== token) {
                // F2: superseded while getUserMedia was resolving — a close
                // (or a newer start) already ran while this one was still in
                // flight. Nothing refers to this camera on purpose; stop it
                // ourselves so it can't orphan, and don't touch whatever
                // ran after us.
                if (scannerRef.current === scanner) {
                    scannerRef.current = null;
                }
                await scanner.stop().catch(() => {});
                return;
            }

            // Check torch capability after camera starts
            try {
                const capabilities = scanner.getRunningTrackCameraCapabilities();
                if (capabilities && capabilities.torchFeature && capabilities.torchFeature().isSupported()) {
                    setTorchAvailable(true);
                }
            } catch {
                setTorchAvailable(false);
            }

            setCameraError(null);
        } catch (err) {
            if (startTokenRef.current !== token) {
                // Superseded — the close/newer start already reset error and
                // torch state; don't resurrect a stale error for a start
                // nobody is waiting on.
                return;
            }
            console.error('Camera start error:', err);
            setCameraError(classifyCameraError(err));
        } finally {
            // Only this call's own generation may clear the "starting" guard
            // — if it was superseded, whatever call replaced it already owns
            // that flag (stopScanner cleared it immediately, and a newer
            // startScanner set it again before this one resumed).
            if (startTokenRef.current === token) {
                isStartingRef.current = false;
            }
        }
    }, []); // No dependencies — uses refs for callbacks, takes facing as parameter

    // Single effect: start/stop scanner when `open` or `facingMode` changes
    useEffect(() => {
        if (open) {
            startScanner(facingMode);
        } else {
            stopScanner();
        }

        return () => {
            stopScanner();
        };
    }, [open, facingMode, startScanner, stopScanner]);

    // F3: `role="dialog" aria-modal="true"` promises everything outside is
    // inert. Every other dialog-shaped surface in this app gets that from
    // antd's Drawer (portal, mask, focus trap, Escape); this one is
    // hand-rolled, so it earns the promise itself here: Escape closes it, and
    // — in the effect below — focus moves onto the close button on open and
    // is restored to whatever had it on close. A full focus trap (blocking
    // Tab from ever reaching the browser chrome) is deliberately not
    // implemented.
    useEffect(() => {
        if (!open) return undefined;
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                onCloseRef.current();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [open]);

    // Focus management half of F3: move focus into the dialog (the close
    // button — the sensible target, always present) when it opens, and put
    // focus back where it was when it closes. Best-effort restore only: if
    // the previously focused element has since been unmounted (e.g. the
    // trigger button lives in a view the parent hides while the scanner is
    // open), `.focus()` on a detached node is a silent no-op rather than an
    // error.
    useEffect(() => {
        if (open) {
            previouslyFocusedRef.current = document.activeElement;
            closeButtonRef.current?.focus();
        } else if (previouslyFocusedRef.current) {
            previouslyFocusedRef.current.focus();
            previouslyFocusedRef.current = null;
        }
    }, [open]);

    // Retry after a start failure — re-runs the same start path the effect
    // above uses, so a successful retry clears cameraError the same way.
    const handleRetry = useCallback(() => {
        startScanner(facingMode);
    }, [startScanner, facingMode]);

    // Toggle torch
    const handleToggleTorch = useCallback(async () => {
        if (!scannerRef.current) return;
        try {
            const capabilities = scannerRef.current.getRunningTrackCameraCapabilities();
            const torch = capabilities.torchFeature();
            if (torchOn) {
                await torch.disable();
                setTorchOn(false);
            } else {
                await torch.enable();
                setTorchOn(true);
            }
        } catch (e) {
            console.error('Torch toggle error:', e);
        }
    }, [torchOn]);

    // Flip camera
    const handleFlipCamera = useCallback(() => {
        setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');
    }, []);

    if (!open) return null;

    return (
        <div className="scanner-overlay" role="dialog" aria-modal="true" aria-label={t.scan}>
            {/* Top bar */}
            <div className="scanner-top-bar">
                <button
                    type="button"
                    className="scanner-close-btn"
                    aria-label={t.close}
                    onClick={onClose}
                    ref={closeButtonRef}
                >
                    <IosIcon name="close" size={20} stroke={2.4}/>
                </button>
                <div className="scanner-top-actions">
                    {torchAvailable && (
                        <button
                            type="button"
                            className="scanner-control-btn"
                            onClick={handleToggleTorch}
                            aria-pressed={torchOn}
                            aria-label={t.torchToggle}
                            data-testid="scanner-torch-btn"
                        >
                            {torchOn
                                ? <BulbFilled style={{fontSize: 22, color: '#fadb14'}}/>
                                : <BulbOutlined style={{fontSize: 22, color: '#fff'}}/>
                            }
                        </button>
                    )}
                    <button
                        type="button"
                        className="scanner-control-btn"
                        onClick={handleFlipCamera}
                        aria-label={t.flipCamera}
                        data-testid="scanner-flip-btn"
                    >
                        <SwapOutlined style={{fontSize: 22, color: '#fff'}}/>
                    </button>
                </div>
            </div>

            {/* Scanner video area */}
            <div className="scanner-video-container">
                <div ref={containerRef} id={SCANNER_ELEMENT_ID} className="scanner-video-element"/>

                {/* Viewfinder overlay */}
                <div className="scanner-viewfinder">
                    <div className="viewfinder-box">
                        <div className="viewfinder-corner viewfinder-corner-tl"/>
                        <div className="viewfinder-corner viewfinder-corner-tr"/>
                        <div className="viewfinder-corner viewfinder-corner-bl"/>
                        <div className="viewfinder-corner viewfinder-corner-br"/>
                        <div className="viewfinder-scan-line"/>
                    </div>
                </div>

                {/* Camera error */}
                {cameraError && (
                    <div className="scanner-error">
                        <IosIcon name="warn" size={32} stroke={2}/>
                        <p className="scanner-error-message">{t[cameraError.messageKey]}</p>
                        {cameraError.detail && (
                            <p className="scanner-error-detail">{cameraError.detail}</p>
                        )}
                        {cameraError.canRetry && (
                            <button type="button" className="scanner-retry-btn" onClick={handleRetry}>
                                {t.retry}
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Bottom controls */}
            <div className="scanner-bottom-bar">
                <span className="scanner-glass-pill scanner-hint">{t.scanHint}</span>
                {onManualSearch && (
                    <button
                        type="button"
                        className="scanner-glass-pill scanner-manual-search-btn"
                        onClick={onManualSearch}
                    >
                        <IosIcon name="keyboard" size={22}/>
                        {t.manualSearch}
                    </button>
                )}
            </div>
        </div>
    );
};

export default BarcodeScanner;

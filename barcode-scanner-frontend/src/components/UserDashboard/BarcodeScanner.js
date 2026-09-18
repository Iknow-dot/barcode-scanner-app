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
    const [torchOn, setTorchOn] = useState(false);
    const [torchAvailable, setTorchAvailable] = useState(false);
    const [facingMode, setFacingMode] = useState('environment');
    // classifyCameraError() result ({kind, messageKey, canRetry, detail}), or null
    const [cameraError, setCameraError] = useState(null);

    // Store onScan in a ref so the scanner callback never goes stale
    // and never causes dependency-chain re-renders
    const onScanRef = useRef(onScan);
    useEffect(() => {
        onScanRef.current = onScan;
    }, [onScan]);

    const stopScanner = useCallback(async () => {
        isStartingRef.current = false;
        if (scannerRef.current) {
            try {
                const state = scannerRef.current.getState();
                if (isActiveScanState(state)) {
                    await scannerRef.current.stop();
                }
            } catch (e) {
                // Ignore stop errors during cleanup
            }
            scannerRef.current = null;
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

        // Ensure any previous instance is cleaned up
        if (scannerRef.current) {
            try {
                const state = scannerRef.current.getState();
                if (isActiveScanState(state)) {
                    await scannerRef.current.stop();
                }
            } catch (e) {
                // ignore
            }
            scannerRef.current = null;
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
            console.error('Camera start error:', err);
            setCameraError(classifyCameraError(err));
        } finally {
            isStartingRef.current = false;
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
                <button type="button" className="scanner-close-btn" aria-label={t.close} onClick={onClose}>
                    <IosIcon name="close" size={20} stroke={2.4}/>
                </button>
                <div className="scanner-top-actions">
                    {torchAvailable && (
                        <button
                            type="button"
                            className="scanner-control-btn"
                            onClick={handleToggleTorch}
                            aria-pressed={torchOn}
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
                <span className="scanner-hint">{t.scanHint}</span>
                {onManualSearch && (
                    <button type="button" className="scanner-manual-search-btn" onClick={onManualSearch}>
                        <IosIcon name="keyboard" size={22}/>
                        {t.manualSearch}
                    </button>
                )}
            </div>
        </div>
    );
};

export default BarcodeScanner;

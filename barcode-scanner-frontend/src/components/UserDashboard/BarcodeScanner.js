import React, {useEffect, useRef, useState, useCallback} from 'react';
import {Html5Qrcode} from 'html5-qrcode';
import {Button, Typography, Space} from 'antd';
import {
    CloseOutlined,
    BulbOutlined,
    BulbFilled,
    SwapOutlined,
} from '@ant-design/icons';
import {useLanguage} from '../../i18n/LanguageContext';
import './BarcodeScanner.css';

const {Text} = Typography;

const SCANNER_ELEMENT_ID = 'barcode-scanner-video';

const BarcodeScanner = ({open, onScan, onClose}) => {
    const {t} = useLanguage();
    const scannerRef = useRef(null);
    const hasScannedRef = useRef(false);
    const isStartingRef = useRef(false);
    const [torchOn, setTorchOn] = useState(false);
    const [torchAvailable, setTorchAvailable] = useState(false);
    const [facingMode, setFacingMode] = useState('environment');
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
                // State 2 = SCANNING, State 3 = PAUSED
                if (state === 2 || state === 3) {
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
                if (state === 2 || state === 3) {
                    await scannerRef.current.stop();
                }
            } catch (e) {
                // ignore
            }
            scannerRef.current = null;
        }

        hasScannedRef.current = false;

        // Small delay to ensure DOM element is ready
        await new Promise(resolve => setTimeout(resolve, 100));

        const element = document.getElementById(SCANNER_ELEMENT_ID);
        if (!element) {
            isStartingRef.current = false;
            return;
        }

        const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);
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
            setCameraError(
                typeof err === 'string' ? err : err?.message || 'Camera error'
            );
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
        <div className="scanner-overlay">
            {/* Top bar */}
            <div className="scanner-top-bar">
                <Text className="scanner-title">
                    {t.scan || 'Scan'}
                </Text>
                <Button
                    type="text"
                    icon={<CloseOutlined/>}
                    onClick={onClose}
                    className="scanner-close-btn"
                    size="large"
                />
            </div>

            {/* Scanner video area */}
            <div className="scanner-video-container">
                <div id={SCANNER_ELEMENT_ID} className="scanner-video-element"/>

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
                        <Text style={{color: '#fff', textAlign: 'center', padding: 24}}>
                            {cameraError}
                        </Text>
                    </div>
                )}
            </div>

            {/* Bottom controls */}
            <div className="scanner-bottom-bar">
                <Space size="large">
                    {torchAvailable && (
                        <Button
                            type="text"
                            shape="circle"
                            size="large"
                            className="scanner-control-btn"
                            icon={torchOn
                                ? <BulbFilled style={{fontSize: 22, color: '#fadb14'}}/>
                                : <BulbOutlined style={{fontSize: 22, color: '#fff'}}/>
                            }
                            onClick={handleToggleTorch}
                        />
                    )}
                    <Button
                        type="text"
                        shape="circle"
                        size="large"
                        className="scanner-control-btn"
                        icon={<SwapOutlined style={{fontSize: 22, color: '#fff'}}/>}
                        onClick={handleFlipCamera}
                    />
                </Space>
                <Text className="scanner-hint">
                    {t.scanHint || 'Point camera at a barcode'}
                </Text>
            </div>
        </div>
    );
};

export default BarcodeScanner;

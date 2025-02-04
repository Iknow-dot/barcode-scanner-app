import React, { useRef, useEffect } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { processBarcode } from '../../api';

const ScanButton = ({ setScanning, scanning, onScan, disabled }) => {
    const qrRef = useRef(null);

    useEffect(() => {
        let html5QrcodeScanner;
        if (scanning && qrRef.current && !disabled) {
            setTimeout(() => {
                html5QrcodeScanner = new Html5QrcodeScanner(qrRef.current.id, {
                    fps: 30,
                    qrbox: 150,
                    aspectRatio: 1.777778,
                    videoConstraints: {
                        facingMode: "environment",
                        width: { ideal: 4096 },
                        height: { ideal: 2160 },
                        advanced: [{ zoom: 1.5 }] // Attempt to set zoom to 2x, adjust this value as needed
                    },
                    disableFlip: false
                });
                html5QrcodeScanner.render((decodedText) => {
                    onScan(decodedText);
                }, (errorMessage, errorType, errorInstance) => {
                    console.error(errorMessage);
                    if (errorInstance instanceof Html5QrcodeScanner && errorInstance.getScanner) {
                        const scanner = errorInstance.getScanner();
                        if (scanner && scanner.getVideoElement) {
                            captureAndProcessFrame(scanner.getVideoElement());
                        }
                    }
                });
            }, 100);
        }

        return () => {
            if (html5QrcodeScanner) {
                html5QrcodeScanner.clear();
            }
        };
    }, [scanning, onScan, disabled]);

    // Function to capture frame and process barcode
    const captureAndProcessFrame = async (videoElement) => {
        const canvas = document.createElement('canvas');
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(async (blob) => {
            try {
                const result = await processBarcode(blob);
                onScan(result.barcodes.join(', ')); // Handle multiple barcodes or adjust based on API response
            } catch (error) {
                console.error("Error processing barcode through backend:", error);
            }
        });
    };

    // Apply styles based on the disabled state
    const buttonStyle = disabled ? {
        backgroundColor: '#ccc', // Grey out button
        color: '#666', // Dark grey text
        cursor: 'not-allowed', // Change cursor to indicate non-interactivity
        opacity: 0.5 // Make button transparent
    } : {};

    return (
        <div className="scanner-container">
            {!scanning ? (
                <button
                    className="scan-button"
                    onClick={() => { if (!disabled) setScanning(true); }}
                    disabled={disabled}
                    style={buttonStyle}
                >
                    დასკანერება
                </button>
            ) : (
                <button
                    className="stop-scan-button"
                    style={{ backgroundColor: 'red' }}
                    onClick={() => setScanning(false)}
                >
                    დახურვა
                </button>
            )}
            <div ref={qrRef} id="qr-reader" className="qr-reader"></div>
        </div>
    );
};

export default ScanButton;

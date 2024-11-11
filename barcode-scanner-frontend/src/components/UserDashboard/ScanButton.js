import React, { useRef, useEffect } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';

const ScanButton = ({ setScanning, scanning, onScan, disabled }) => {
    const qrRef = useRef(null);

    useEffect(() => {
        let html5QrcodeScanner;
        if (scanning && qrRef.current && !disabled) {
            setTimeout(() => {
                html5QrcodeScanner = new Html5QrcodeScanner(qrRef.current.id, {
                    fps: 10,
                    qrbox: 250,
                    disableFlip: false
                });
                html5QrcodeScanner.render((decodedText) => {
                    onScan(decodedText);
                }, errorMessage => {
                    console.error(errorMessage);
                });
            }, 100);
        }

        return () => {
            if (html5QrcodeScanner) {
                html5QrcodeScanner.clear();
            }
        };
    }, [scanning, onScan, disabled]);

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

import React, { useRef, useEffect } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';


const ScanButton = ({ setScanning, scanning, onScan }) => {
    const qrRef = useRef(null);

    useEffect(() => {
        let html5QrcodeScanner;
        if (scanning && qrRef.current) {
            setTimeout(() => {
                html5QrcodeScanner = new Html5QrcodeScanner(qrRef.current.id, {
                    fps: 10,
                    qrbox: 250,
                    disableFlip: false
                });
                html5QrcodeScanner.render((decodedText) => {
                    console.log(`Decoded text: ${decodedText}`);
                    onScan(decodedText);  // Call the function passed as prop with the decoded text

                }, errorMessage => {
                    console.error(errorMessage);
                });
            }, 100);  // Delay to ensure the ref is mounted
        }

        return () => {
            if (html5QrcodeScanner) {
                html5QrcodeScanner.clear();
            }
        };
    }, [scanning, onScan]);

    return (
        <div className="scanner-container">
            {!scanning ? (
                <button className="scan-button" onClick={() => setScanning(true)}>
                    დასკანერება
                </button>
            ) : (
                <button className="stop-scan-button" style={{ 'background-color': 'red' }} onClick={() => setScanning(false)}>
                    დახურვა
                </button>
            )}
            <div ref={qrRef} id="qr-reader" className="qr-reader"></div>
        </div>
    );
};

export default ScanButton;

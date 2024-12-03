import React, { useRef, useEffect, useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import Quagga from 'quagga';

const ScanButton = ({ setScanning, scanning, onScan, disabled }) => {
    const qrRef = useRef(null);
    const [quaggaActive, setQuaggaActive] = useState(false); // State to track Quagga's activity

    useEffect(() => {
        let scanner;
        const userAgent = navigator.userAgent;
        if (scanning && qrRef.current && !disabled) {
            if (/iPhone|iPad|iPod/i.test(userAgent)) {
                Quagga.init({
                    inputStream: {
                        name: "Live",
                        type: "LiveStream",
                        target: qrRef.current,
                        constraints: {
                            facingMode: "environment",
                            width: window.innerWidth,
                            height: window.innerHeight
                        },
                        area: {
                            top: "0%",
                            right: "0%",
                            left: "0%",
                            bottom: "0%"
                        }
                    },
                    decoder: {
                        readers: [
                            "code_128_reader",
                            "ean_reader",
                            "ean_8_reader",
                            "code_39_reader",
                            "code_39_vin_reader",
                            "codabar_reader",
                            "upc_reader",
                            "upc_e_reader"
                        ]
                    }
                }, (err) => {
                    if (err) {
                        console.error('Initialization error in Quagga:', err);
                        return;
                    }
                    Quagga.start();
                    setQuaggaActive(true);
                });

                Quagga.onDetected((result) => {
                    onScan(result.codeResult.code);
                });
            } else {
                setTimeout(() => {
                    scanner = new Html5QrcodeScanner(qrRef.current.id, {
                        fps: 10,
                        qrbox: 250,
                        disableFlip: false
                    });
                    scanner.render((decodedText) => {
                        onScan(decodedText);
                    }, errorMessage => {
                        console.error(errorMessage);
                    });
                }, 100);
            }
        }

        return () => {
            if (scanner) {
                scanner.clear();
            }
            if (quaggaActive) {
                Quagga.stop();
                setQuaggaActive(false);
                // Explicitly clear the video element by setting its srcObject to null
                const videoElement = qrRef.current.querySelector('video');
                if (videoElement) {
                    videoElement.srcObject = null;
                }
            }
        };
    }, [scanning, onScan, disabled]);

    const stopScanning = () => {
        if (quaggaActive) {
            Quagga.stop();
            setQuaggaActive(false);
            const videoElement = qrRef.current.querySelector('video');
            if (videoElement) {
                videoElement.srcObject = null;
            }
        }
        setScanning(false);
    };

    const buttonStyle = disabled ? {
        backgroundColor: '#ccc',
        color: '#666',
        cursor: 'not-allowed',
        opacity: 0.5
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
                    onClick={stopScanning}
                >
                    დახურვა
                </button>
            )}
            <div ref={qrRef} id="qr-reader" className={!scanning ? "hidden" : "qr-reader"}></div>
        </div>
    );
};

export default ScanButton;

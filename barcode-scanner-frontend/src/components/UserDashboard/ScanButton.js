import React, { useRef, useEffect } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { processBarcode } from '../../api';
import {ScanOutlined} from "@ant-design/icons";
import {Button} from "antd";

const ScanButton = ({ setScanning, scanning, onScan, disabled, qrRef }) => {

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

    return (
        <div className="scanner-container">
            {!scanning ? (
                <Button
                    variant="outlined"
                    color="green"
                    onClick={() => { if (!disabled) setScanning(true); }}
                    disabled={disabled}
                >
                    <ScanOutlined /> დასკანერება
                </Button>
            ) : (
                <Button
                    variant="outlined"
                    onClick={() => setScanning(false)}
                    danger
                >
                    დახურვა
                </Button>
            )}
        </div>
    );
};

export default ScanButton;

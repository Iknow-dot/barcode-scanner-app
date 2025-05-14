import React, {useRef, useEffect} from 'react';
import {Html5QrcodeScanner} from 'html5-qrcode';
import {processBarcode} from '../../api';
import {QrcodeOutlined, ScanOutlined} from "@ant-design/icons";
import {Button} from "antd";

const buttonStyle = {
  position: 'fixed',
  bottom: 48,
  right: "50%",
  zIndex: 1001,
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
  translate: '50% 0',
  transform: "scale(1.3)",
};

const ScanButton = ({setScanning, scanning, onScan, disabled, qrRef}) => {
  const handleScanClick = () => {
    if (!disabled) {
      setScanning(true);
    }
  };

  // Effect to initialize and clean up Html5QrcodeScanner

  useEffect(() => {
    let html5QrcodeScanner;
    if (scanning && qrRef.current && !disabled) {
      setTimeout(() => {
        html5QrcodeScanner = new Html5QrcodeScanner(qrRef.current.id, {
          fps: 30,
          qrbox: 200,
          aspectRatio: 1.777778,
          videoConstraints: {
            facingMode: "environment",
            width: {ideal: 4096},
            height: {ideal: 2160},
            advanced: [{zoom: 1.5}] // Attempt to set zoom to 2x, adjust this value as needed
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
      <>
        {!scanning ? (
            <Button
                type="primary"
                variant="outlined"
                onClick={() => {
                  if (!disabled) setScanning(true);
                }}
                disabled={disabled}
                style={buttonStyle}
            >
              <QrcodeOutlined/> დასკანერება
            </Button>
        ) : (
            <Button
                variant="outlined"
                onClick={() => setScanning(false)}
                danger
                style={buttonStyle}
            >
              დახურვა
            </Button>
        )}
      </>
  );
};

export default ScanButton;

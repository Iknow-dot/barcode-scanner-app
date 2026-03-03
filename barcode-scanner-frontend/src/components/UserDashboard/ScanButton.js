import React, {useRef, useEffect} from 'react';
import {Html5QrcodeScanner} from 'html5-qrcode';
import {QrcodeOutlined, CloseOutlined} from "@ant-design/icons";
import {Button} from "antd";
import {useLanguage} from '../../i18n/LanguageContext';
import "./ScanButton.css"

const ScanButton = ({setScanning, scanning, onScan, disabled, qrRef}) => {
  const {t} = useLanguage();

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
            advanced: [{zoom: 1.5}]
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
    });
  };

  return (
      <>
        {!scanning ? (
            <Button
                type="primary"
                size="large"
                onClick={() => {
                  if (!disabled) setScanning(true);
                }}
                disabled={disabled}
                className="scan-fab"
                icon={<QrcodeOutlined style={{fontSize: 20}}/>}
            >
              {t.scan}
            </Button>
        ) : (
            <Button
                size="large"
                onClick={() => setScanning(false)}
                danger
                type="primary"
                className="scan-fab scan-fab-danger"
                icon={<CloseOutlined style={{fontSize: 18}}/>}
            >
              {t.close}
            </Button>
        )}
      </>
  );
};

export default ScanButton;

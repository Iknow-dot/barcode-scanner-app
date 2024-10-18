import React from 'react';

const ScanButton = ({ onScan }) => {
  return (
    <button onClick={onScan} className="scan-button">
      Start Scan
    </button>
  );
};

export default ScanButton;

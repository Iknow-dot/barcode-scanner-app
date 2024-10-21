import React, { useState, useEffect, useRef } from 'react';
import ScanButton from './ScanButton';
import './UserDashboard.css';

const UserDashboard = () => {
  const [searchType, setSearchType] = useState('barcode');
  const [searchInput, setSearchInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [balances, setBalances] = useState([]);

  const handleSearch = () => {
    const dummyData = [
      { warehouse: "Warehouse 1", article: "123", product: "Product 123", balance: 50, barcode: "4032900160887" },
    ];
    setBalances(dummyData.filter(item => item[searchType].toString().toLowerCase().includes(searchInput.toLowerCase())));
  };

  const handleScanResult = (decodedText) => {

    setSearchInput(decodedText);

    setScanning(false); // Stop scanning after receiving the result

  };

  return (
    <div className="container">
      <h2>Warehouse Balances</h2>
      <div className="search-container">
        <select value={searchType} onChange={e => setSearchType(e.target.value)}>
          <option value="barcode">Barcode</option>
          <option value="article">Article</option>
        </select>
        <input type="text" placeholder="Search..." value={searchInput} onChange={e => setSearchInput(e.target.value)} />
        <button className="search-button" style={{ backgroundColor: '#28a745' }} onClick={handleSearch}>Search</button>
        <ScanButton setScanning={setScanning} scanning={scanning} onScan={handleScanResult} />
      </div>
      {!scanning && (
        <table>
          <thead>
            <tr>
              <th>Warehouse</th>
              <th>Article</th>
              <th>Product</th>
              <th>Balance</th>
              <th>Barcode</th>
            </tr>
          </thead>
          <tbody>
            {balances.map((item, index) => (
              <tr key={index}>
                <td>{item.warehouse}</td>
                <td>{item.article}</td>
                <td>{item.product}</td>
                <td>{item.balance}</td>
                <td>{item.barcode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default UserDashboard;

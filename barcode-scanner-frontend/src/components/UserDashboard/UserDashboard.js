import React, { useState } from 'react';
import ScanButton from './ScanButton';
import './UserDashboard.css';

const UserDashboard = () => {
  const [searchType, setSearchType] = useState('barcode');
  const [searchInput, setSearchInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [balances, setBalances] = useState([]);
  const [allWarehouses, setAllWarehouses] = useState(false); // State to toggle between all warehouses or user-specific

  // Example user-specific warehouse data
  const userWarehouses = ['Warehouse 1', 'Warehouse 2'];

  const handleSearch = () => {
    const dummyData = [
      { warehouse: "Warehouse 1", article: "123", product: "Product 123", balance: 50, barcode: "4032900160887" },
      { warehouse: "Warehouse 2", article: "456", product: "Product 456", balance: 75, barcode: "4032900160994" },
      { warehouse: "Warehouse 3", article: "789", product: "Product 789", balance: 20, barcode: "4032900161007" }
    ];
    // Filter data based on the search type, input, and whether all warehouses should be shown
    const filteredData = dummyData.filter(item =>
      item[searchType].toString().toLowerCase().includes(searchInput.toLowerCase()) &&
      (allWarehouses || userWarehouses.includes(item.warehouse))
    );
    setBalances(filteredData);
  };

  const handleScanResult = (decodedText) => {
    setSearchInput(decodedText);
    setScanning(false); // Stop scanning after receiving the result
  };

  return (
    <div className="container">
      <h2>Warehouse Balances</h2>
      <div className="search-container">
        <div className="first-line">
          <select value={searchType} onChange={e => setSearchType(e.target.value)}>
            <option value="barcode">Barcode</option>
            <option value="article">Article</option>
          </select>
          <input type="text" placeholder="Search..." value={searchInput} onChange={e => setSearchInput(e.target.value)} />
        </div>
        <div className={`sec-line ${scanning ? 'column-layout' : ''}`}>
          <div className="checkbox-cntr">
            <label>
              <input
                className="custom-checkbox"
                type="checkbox"
                checked={allWarehouses}
                onChange={() => setAllWarehouses(!allWarehouses)}
              /> All Warehouses
            </label>
          </div>
          <button className="search-button" style={{ backgroundColor: '#28a745' }} onClick={handleSearch}>Search</button>
          <ScanButton setScanning={setScanning} scanning={scanning} onScan={handleScanResult} />
        </div>
      </div>
      {!scanning && (
        <table>
          <thead>
            <tr>
              <th>Warehouse</th>
              <th>Article</th>
              <th>Product</th>
              <th>Balance</th>
              <th>Price</th>
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
                <td>{item.price}</td>
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

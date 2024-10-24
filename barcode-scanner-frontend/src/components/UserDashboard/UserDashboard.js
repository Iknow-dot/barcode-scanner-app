import React, { useState, useEffect } from 'react';
import { scanProducts, getUserWarehouses } from '../../api';  // Import the new API call
import ScanButton from './ScanButton';
import './UserDashboard.css';

const UserDashboard = () => {
  const [searchType, setSearchType] = useState('barcode');
  const [searchInput, setSearchInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [balances, setBalances] = useState([]);
  const [price, setPrice] = useState(null); // State to store price
  const [productName, setProductName] = useState(''); // State to store product name (sku_name)
  const [allWarehouses, setAllWarehouses] = useState(false); // State to toggle between all warehouses or user-specific
  const [userWarehouses, setUserWarehouses] = useState([]);  // State for storing the fetched user-specific warehouses

  // Fetch user's warehouses when the component is mounted
  useEffect(() => {
    const fetchWarehouses = async () => {
      try {
        const data = await getUserWarehouses();  // Fetch user-specific warehouses
        setUserWarehouses(data);  // Store fetched warehouses
      } catch (error) {
        console.error("Failed to fetch user warehouses:", error);
      }
    };

    fetchWarehouses();
  }, []);  // Only run once when the component is mounted

  const handleSearch = async () => {
    try {
      // If "All Warehouses" is checked, send an empty string
      // Otherwise, join warehouse codes from the user's warehouses
      const warehouseCodes = allWarehouses ? '' : userWarehouses.map(warehouse => warehouse.code).join(',');
      console.log("Sending data:", { searchInput, searchType, warehouseCodes });  // Log outgoing request data

      const data = await scanProducts(searchInput, searchType, warehouseCodes);
      console.log("Received data:", data);  // Log response data

      if (data && data.stock) {
        setBalances(data.stock);  // Set the stock data (balances)
        setPrice(data.price);     // Set the price
        setProductName(data.sku_name);  // Set the product name (sku_name)
      } else {
        console.error("Received data does not contain stock information:", data);
        setBalances([]);  // Reset to an empty array if the data is not valid
        setPrice(null);   // Reset price
        setProductName(''); // Reset product name
      }
    } catch (error) {
      console.error("Failed to fetch balances:", error.message);
      setBalances([]);  // Set to an empty array on error
      setPrice(null);   // Reset price on error
      setProductName(''); // Reset product name on error
    }
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
          <input 
            type="text" 
            placeholder="Search..." 
            value={searchInput} 
            onChange={e => setSearchInput(e.target.value)} 
          />
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
      {!scanning && balances.length > 0 && (
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
                <td>{item.warehouse_name}</td>  {/* Display warehouse_name */}
                <td>{searchInput}</td>  {/* Show the search input (article or barcode) */}
                <td>{productName}</td>  {/* Display the product name (sku_name) */}
                <td>{item.quantity}</td>  {/* Display the balance (quantity) */}
                <td>{price}</td>  {/* Display the price */}
                <td>{searchInput}</td>  {/* Display the search input again as the barcode/article */}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default UserDashboard;

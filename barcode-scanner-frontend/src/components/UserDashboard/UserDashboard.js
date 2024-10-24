import React, { useState, useEffect } from 'react';
import { scanProducts, getUserWarehouses } from '../../api';
import ScanButton from './ScanButton';
import { Carousel } from 'react-responsive-carousel';
import 'react-responsive-carousel/lib/styles/carousel.min.css';
import './UserDashboard.css';

const UserDashboard = () => {
  const [searchType, setSearchType] = useState('barcode');
  const [searchInput, setSearchInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [balances, setBalances] = useState([]);
  const [price, setPrice] = useState(null);
  const [productName, setProductName] = useState('');
  const [allWarehouses, setAllWarehouses] = useState(false);
  const [userWarehouses, setUserWarehouses] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [selectedImages, setSelectedImages] = useState([]);

  useEffect(() => {
    const fetchWarehouses = async () => {
      try {
        const data = await getUserWarehouses();
        setUserWarehouses(data);
      } catch (error) {
        console.error("Failed to fetch user warehouses:", error);
      }
    };

    fetchWarehouses();
  }, []);

  const handleSearch = async () => {
    try {
      const warehouseCodes = allWarehouses ? '' : userWarehouses.map(warehouse => warehouse.code).join(',');
      const data = await scanProducts(searchInput, searchType, warehouseCodes);

      if (data && data.stock) {
        setBalances(data.stock);
        setPrice(data.price);
        setProductName(data.sku_name);
      } else {
        setBalances([]);
        setPrice(null);
        setProductName('');
      }
    } catch (error) {
      setBalances([]);
      setPrice(null);
      setProductName('');
    }
  };

  const handleScanResult = (decodedText) => {
    setSearchInput(decodedText);
    setScanning(false);
  };

  const handleOpenModal = (images) => {
    // Ensure the images exist and are an array
    if (Array.isArray(images) && images.length > 0) {
      setSelectedImages(images);
      setShowModal(true);
    } else {
      console.error("No images available or img_url is undefined.");
      setSelectedImages([]);  // Set an empty array if no valid images
    }
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
                <td>{item.warehouse_name}</td>
                <td>{searchInput}</td>
                <td 
                  onClick={() => handleOpenModal(item.img_url)} 
                  style={{ cursor: 'pointer', color: 'blue' }}>
                  {productName}
                </td>
                <td>{item.quantity}</td>
                <td>{price}</td>
                <td>{searchInput}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showModal && selectedImages.length > 0 && (
        <div className="modal">
          <div className="modal-content">
            <span className="close" onClick={() => setShowModal(false)}>&times;</span>
            <Carousel>
              {selectedImages.map((img, index) => (
                <div key={index}>
                  <img src={img} alt={`Slide ${index}`} />
                </div>
              ))}
            </Carousel>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserDashboard;

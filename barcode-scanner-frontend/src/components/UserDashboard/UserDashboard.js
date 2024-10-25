import React, { useState, useEffect, useContext } from 'react';
import { scanProducts, getUserWarehouses } from '../../api';
import ScanButton from './ScanButton';
import { Carousel } from 'react-responsive-carousel';
import 'react-responsive-carousel/lib/styles/carousel.min.css';
import './UserDashboard.css';
import AuthContext from '../Auth/AuthContext';

const UserDashboard = () => {
  const [searchType, setSearchType] = useState('barcode');
  const [searchInput, setSearchInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [balances, setBalances] = useState([]);
  const [allWarehouses, setAllWarehouses] = useState(false);
  const [userWarehouses, setUserWarehouses] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [selectedImages, setSelectedImages] = useState([]);
  const [productInfo, setProductInfo] = useState({ sku_name: '', article: '', price: '' });
  const { authData, logout } = useContext(AuthContext);

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
        setProductInfo({
          sku_name: data.sku_name,
          article: data.article,
          price: data.price
        });
      } else {
        setBalances([]);
        setProductInfo({ sku_name: '', article: '', price: '' });
      }
    } catch (error) {
      console.error("Error during search:", error.message);
      setBalances([]);
      setProductInfo({ sku_name: '', article: '', price: '' });
    }
  };

  const handleScanResult = (decodedText) => {
    setSearchInput(decodedText);
    setScanning(false);
  };

  const handleOpenModal = (images) => {
    if (Array.isArray(images) && images.length > 0) {
      setSelectedImages(images);
      setShowModal(true);
    } else {
      console.error("No images available or img_url is undefined.");
      setSelectedImages([]);
    }
  };

  return (
    <div className="container">
      <div className='header'>
        <h2>ნაშთები</h2>
        <button onClick={logout} className="logout-btn">გასვლა</button>
      </div>
      <div className="search-container">
        <div className="first-line">
          <select value={searchType} onChange={e => setSearchType(e.target.value)}>
            <option value="barcode">შტრიხკოდი</option>
            <option value="article">არტიკული</option>
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
              /> ყველა საწყობი
            </label>
          </div>
          <button className="search-button" style={{ backgroundColor: '#28a745' }} onClick={handleSearch}>ძებნა</button>
          <ScanButton setScanning={setScanning} scanning={scanning} onScan={handleScanResult} />
        </div>
      </div>
      {!scanning && balances.length > 0 && (
        <>
          <p><strong>პროდუქტი:</strong> {productInfo.sku_name} </p>
          <p><strong>არტიკული:</strong> {productInfo.article}</p>
          <table>
            <thead>
              <tr>
                <th>საწყობი</th>
                <th>ნაშთი</th>
                <th>ფასი</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((item, index) => (
                <tr key={index}>
                  <td>{item.warehouse_name}</td>
                  <td>{item.quantity}</td>
                  <td>{productInfo.price} ₾</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
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

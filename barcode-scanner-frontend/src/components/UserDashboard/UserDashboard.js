import React, { useState, useEffect, useContext } from 'react';
import { scanProducts, getUserWarehouses, getClientIp } from '../../api';
import ScanButton from './ScanButton';
import Carousel from 'react-multi-carousel';
import 'react-multi-carousel/lib/styles.css';
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
  const [productInfo, setProductInfo] = useState({ sku_name: '', article: '', price: '', img_url: [] });
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

  const responsive = {
    desktop: {
      breakpoint: { max: 3000, min: 1024 },
      items: 1
    },
    tablet: {
      breakpoint: { max: 1024, min: 464 },
      items: 1
    },
    mobile: {
      breakpoint: { max: 464, min: 0 },
      items: 1
    }
  };

  const handleSearch = async () => {
    
    try {
      // Check IP before proceeding with search
      const ipData = await getClientIp();
      if (!ipData.success || !ipData.ip.allowed) {
        alert("წვდომა შეზღუდულია!");
        // setErrorMessage('Access from your IP address is restricted.');
        return; // Exit function if IP check fails
      }
  
      const warehouseCodes = allWarehouses ? '' : userWarehouses.map(warehouse => warehouse.code).join(',');
      const data = await scanProducts(searchInput, searchType, warehouseCodes);
      console.log(warehouseCodes);
  
      if (data && data.stock) {
        setBalances(data.stock);
        setProductInfo({
          sku_name: data.sku_name,
          article: data.article,
          price: data.price,
          img_url: data.img_url
        });
      } else {
        setBalances([]);
        setProductInfo({ sku_name: '', article: '', price: '', img_url: [] });
      }
       
    } catch (error) {
      console.error("Error during search:", error.message);
      setBalances([]);
      setProductInfo({ sku_name: '', article: '', price: '', img_url: [] });
      alert("არ მოიძებნა!");
    }
  }

  const handleScanResult = (decodedText) => {
    setSearchInput(decodedText);
    setScanning(false);
  };

  const handleOpenModal = () => {
    // console.log("Opening modal with images:", productInfo.img_url); // Debug: log the images
    if (Array.isArray(productInfo.img_url) && productInfo.img_url.length > 0) {
      setSelectedImages(productInfo.img_url);
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
          <ScanButton setScanning={setScanning} scanning={scanning} onScan={handleScanResult} disabled={searchType === 'article'} />
        </div>
      </div>
      {!scanning && balances.length > 0 && (
        <>
          <p><strong>პროდუქტი:</strong> <span onClick={handleOpenModal} style={{ cursor: 'pointer', textDecoration: 'underline' }}>{productInfo.sku_name}</span> </p>
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

      {showModal && (
        <div className="modal" style={{ display: 'block', zIndex: 1000, position: 'absolute', width: '100%', height: '100%', top: '0', left: '0', background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-content">
            <span className="close" onClick={() => setShowModal(false)}>&times;</span>
            <Carousel
              responsive={responsive}
              ssr={true} // means to render carousel on server-side.
              infinite={true}
              autoPlay={scanning ? true : false}
              autoPlaySpeed={3000}
              keyBoardControl={true}
              customTransition="all .5"
              transitionDuration={500}
              containerClass="carousel-container"
              removeArrowOnDeviceType={["tablet", "mobile"]}
              deviceType={responsive}
              dotListClass="custom-dot-list-style"
              itemClass="carousel-item-padding-40-px"
            >
              {selectedImages.map((img, index) => (
                <div key={index}>
                  <img src={img} alt={`Slide ${index}`} style={{ width: '100%', height: 'auto' }} />
                </div>
              ))}
            </Carousel>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserDashboard

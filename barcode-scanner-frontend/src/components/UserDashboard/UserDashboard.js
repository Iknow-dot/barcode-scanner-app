import React, {useState, useEffect, useContext, useRef} from 'react';
import {scanProducts, getUserWarehouses, getClientIp} from '../../api';
import ScanButton from './ScanButton';
import Carousel from 'react-multi-carousel';
import AuthContext from '../Auth/AuthContext';
import {registerServiceWorker} from '../serviceWorkerRegistration';
import subNavContext from "../../contexts/SubNavContext";
import {Button, Card, Checkbox, Descriptions, Form, Input, Modal, Select, Space, Switch, Table} from "antd";
import {BarcodeOutlined, NumberOutlined, SearchOutlined} from "@ant-design/icons";

const UserDashboard = () => {
  const [form] = Form.useForm();
  const [disableScan, setDisableScan] = useState(false);
  const {setSubNav} = useContext(subNavContext);
  const [scanning, setScanning] = useState(false);
  const [balances, setBalances] = useState([]);
  const [userWarehouses, setUserWarehouses] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [selectedImages, setSelectedImages] = useState([]);
  const [productInfo, setProductInfo] = useState({sku_name: '', article: '', price: '', img_url: []});
  const qrRef = useRef(null);

  // Function to be called on any click
  function handleClick(event) {
    registerServiceWorker();
    // Your custom logic here
  }

  // Add event listener to the document to listen for any clicks
  document.addEventListener('click', handleClick);

  useEffect(() => {
    setSubNav(null);
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
      breakpoint: {max: 3000, min: 1024},
      items: 1
    },
    tablet: {
      breakpoint: {max: 1024, min: 464},
      items: 1
    },
    mobile: {
      breakpoint: {max: 464, min: 0},
      items: 1
    }
  };

  const handleSearch = async ({search, allWarehouses, searchType}) => {
    try {
      // Check IP before proceeding with search
      const ipData = await getClientIp();
      if (!ipData.success || !ipData.ip.allowed) {
        alert("წვდომა შეზღუდულია!");
        // setErrorMessage('Access from your IP address is restricted.');
        return; // Exit function if IP check fails
      }

      const warehouseCodes = allWarehouses ? '' : userWarehouses.map(warehouse => warehouse.code).join(',');
      const data = await scanProducts(search, searchType, warehouseCodes);
      // console.log(warehouseCodes);
      // console.log(data);

      if (data && data.stock) {
        setBalances(data.stock);
        setProductInfo({
          sku_name: data.sku_name,
          article: data.article,
          price: data.price,
          img_url: data.images
        });
      } else {
        setBalances([]);
        setProductInfo({sku_name: '', article: '', price: '', img_url: []});
      }

    } catch (error) {
      console.error("Error during search:", error.message);
      setBalances([]);
      setProductInfo({sku_name: '', article: '', price: '', img_url: []});
      alert("არ მოიძებნა!");
    }
  }

  const handleScanResult = (decodedText) => {
    setScanning(false);
  };

  const handleOpenModal = () => {
    // Check and set base64 images
    if (Array.isArray(productInfo.img_url) && productInfo.img_url.length > 0) {
      setSelectedImages(productInfo.img_url.map(img => img.base64));
      setShowModal(true);
    } else {
      console.error("No base64 images available.");
      setSelectedImages([]);
    }
    // console.log(productInfo.img_url.map(img => img.base64));
  };


  return (
      <div className="container">
        <Form
            form={form}
            onFinish={handleSearch}
            initialValues={{
              searchType: 'barcode'
            }}
            layout="horizontal"
        >
          <Form.Item
              name="searchType"
          >
            <Select
                options={[
                  {
                    label: (
                        <>
                          <BarcodeOutlined/> შტრიხკოდი
                        </>
                    ),
                    value: "barcode",
                  },
                  {
                    label: (
                        <>
                          <NumberOutlined/> არტიკული
                        </>
                    ),
                    value: "article",
                  }
                ]}
                onChange={(value) => {
                  if (value === 'barcode') {
                    setDisableScan(false);
                  } else {
                    setDisableScan(true);
                  }
                }}
            >

            </Select>
          </Form.Item>

          <Form.Item
              name="allWarehouses"
              label="ყველა საწყობი"
              initialValue={false}
          >
            <Switch/>
          </Form.Item>
          <Space>
            <Form.Item>
              <ScanButton
                  setScanning={setScanning}
                  scanning={scanning}
                  onScan={handleScanResult}
                  disabled={disableScan}
                  qrRef={qrRef}
              />
            </Form.Item>
            <Form.Item
                name="search"
                rules={[
                  {
                    required: true,
                    message: 'გთხოვთ შეიყვანოთ ძიების ტექსტი!',
                  },
                ]}
            >
              <Input.Search
                  placeholder="ძიება"
                  onSearch={form.submit}
                  enterButton={<SearchOutlined/>}

              />
            </Form.Item>
          </Space>
        </Form>
        <div ref={qrRef} id="qr-reader">

        </div>


        {!scanning && balances.length > 0 && (
            <>
              <Descriptions>
                <Descriptions.Item label="პროდუქტი">
                  {productInfo.sku_name}
                </Descriptions.Item>
                <Descriptions.Item label="არტიკული">{productInfo.article}</Descriptions.Item>
              </Descriptions>
              <Table
                  dataSource={balances}
                  rowClassName={(record, index) => userWarehouses.includes(record.warehouse_name) ? 'highlight-row' : ''}
                  columns={[
                    {
                      title: 'საწყობი',
                      dataIndex: 'warehouse_name',
                      key: 'warehouse_name'
                    },
                    {
                      title: 'ნაშთი',
                      dataIndex: 'quantity',
                      key: 'quantity'
                    },
                    {
                      title: 'ფასი',
                      dataIndex: 'price',
                      key: 'price',
                      render: (text, record) => (
                          <span>{text} ₾</span>
                      )
                    }
                  ]}
              />
            </>
        )}
      </div>
  );
};

export default UserDashboard

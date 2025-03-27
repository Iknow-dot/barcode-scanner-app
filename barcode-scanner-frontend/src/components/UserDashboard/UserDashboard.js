import React, {useState, useEffect, useContext, useRef} from 'react';
import {scanProducts, getUserWarehouses, getClientIp} from '../../api';
import ScanButton from './ScanButton';
import Carousel from 'react-multi-carousel';
import AuthContext from '../Auth/AuthContext';
import {registerServiceWorker} from '../serviceWorkerRegistration';
import subNavContext from "../../contexts/SubNavContext";
import {
  Descriptions,
  Flex,
  Form,
  Input, notification,
  Select,
  Space,
  Spin,
  Switch,
  Table
} from "antd";
import {BarcodeOutlined, NumberOutlined, SearchOutlined} from "@ant-design/icons";

const {Option} = Select;

const UserDashboard = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [disableScan, setDisableScan] = useState(false);
  const {setSubNav} = useContext(subNavContext);
  const [scanning, setScanning] = useState(false);
  const [balances, setBalances] = useState([]);
  const [userWarehouses, setUserWarehouses] = useState([]);
  const [productInfo, setProductInfo] = useState({sku_name: '', article: '', price: '', img_url: []});
  const qrRef = useRef(null);

  const [notificationApi, contextHolder] = notification.useNotification();
  const [notificationData, setNotificationData] = useState({});

  const openNotificationWithIcon = (type, message, description) => {
    notificationApi[type]({
      message, description, showProgress: true, pauseOnHover: true,
    });
  };

  useEffect(() => {
    if (notificationData.message) {
      openNotificationWithIcon(
          notificationData.type,
          notificationData.message,
          notificationData.description
      );
    }
  }, [notificationData]);


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

  const handleSearch = async ({search, searchType, allWarehouses}) => {
    try {
      setLoading(true);
      // Check IP before proceeding with search
      const ipData = await getClientIp();
      if (!ipData.success || !ipData.ip.allowed) {
        setNotificationData({
          type: 'error',
          message: 'შეცდომა',
          description: `შეცდომა იპ-ის შემოწმებისას "(${ipData.ip.error || 'არ გაქვთ წვდომა'})"`
        });
        return;
      }

      const warehouseCodes = allWarehouses ? '' : userWarehouses.map(warehouse => warehouse.code).join(',');
      const data = await scanProducts(search, searchType, warehouseCodes);
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
      setBalances([]);
      setProductInfo({sku_name: '', article: '', price: '', img_url: []});
      setNotificationData({
        type: 'error',
        message: 'შეცდომა',
        description: `პროდუქტის ძიებისას შეცდომა "(${error.response?.data?.error || error.message})"`
      })
    }
    setLoading(false);
  }

  const handleScanResult = (decodedText) => {
    setScanning(false);
  };


  return (
      <>
        {contextHolder}
        <Form
            form={form}
            onFinish={handleSearch}
            initialValues={{
              searchType: 'barcode'
            }}
            layout="horizontal"
        >
          <Flex
              gap="middle"
              justify="center"
          >
            <Form.Item
                name="searchType"
                initialValue="barcode"
                rules={[
                  {
                    required: true,
                    message: 'გთხოვთ აირჩიოთ ძიების ტიპი!',
                  },
                ]}
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
                      setBalances([]);
                      setDisableScan(false);
                    } else {
                      setDisableScan(true);
                    }
                  }}
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
                  enterButton={<SearchOutlined/>}
                  onSearch={form.submit}
                  allowClear
              />
            </Form.Item>
          </Flex>
          <Flex
              gap="middle"
              justify="center"

          >
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
            </Space>
          </Flex>

        </Form>
        <div ref={qrRef} id="qr-reader">

        </div>

        {loading && (
            <Flex gap="middle" justify="center">
              <Spin tip="იტვირთება" size="large">
                <div style={{
                  padding: 50,
                  background: 'rgba(0, 0, 0, 0.05)',
                  borderRadius: 4,
                }}/>
              </Spin>
            </Flex>
        )}

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
                  rowClassName={(record, index) => userWarehouses.map(wh => wh.name).includes(record.warehouse_name) ? 'highlight-row' : ''}
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
                      render: () => (
                          <span>{productInfo.price} ₾</span>
                      )
                    }
                  ]}
              />
            </>
        )}
      </>
  );
};

export default UserDashboard

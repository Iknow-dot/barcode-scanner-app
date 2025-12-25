import React, {useState, useEffect, useContext, useRef} from 'react';
import {scanProducts, getUserWarehouses, getClientIp} from '../../api';
import ScanButton from './ScanButton';
import subNavContext from "../../contexts/SubNavContext";
import {
  Button,
  Carousel,
  Descriptions, Drawer,
  Flex, FloatButton,
  Form,
  Input, notification, Result,
  Select,
  Space,
  Spin,
  Switch,
  Table
} from "antd";
import {BarcodeOutlined, NumberOutlined, QrcodeOutlined, SearchOutlined, UpOutlined} from "@ant-design/icons";


const UserDashboard = () => {
  const [drawerVisible, setDrawerVisible] = useState(true);
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
        setDrawerVisible(false);
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
        description: `პროდუქტი ვერ მოიძებნა`
      })
    }
    setLoading(false);
  }

  const handleScanResult = (decodedText) => {
    setScanning(false);
    handleSearch({
      search: decodedText,
      searchType: 'barcode',
      allWarehouses: form.getFieldValue('allWarehouses')
    });
  };


  return (
      <>
        {contextHolder}
        {(balances.length === 0 || scanning) && (
            <Result
                status="info"
                title="პროდუქტის ძიება"
                subTitle="მოძებნეთ პროდუქტი შტრიხკოდის ან არტიკულის მიხედვით"
                extra={<>
                  <Button
                      type="primary"
                      onClick={() => setDrawerVisible(true)}
                  >
                    ძებნა
                  </Button>
                  <div style={{
                    marginTop: 20,
                  }}>
                    <div
                        ref={qrRef}
                        id="qr-reader"
                    />
                    {scanning && (
                        <Button
                            variant="outlined"
                            onClick={() => setScanning(false)}
                            danger
                            style={{
                              marginTop: 10,
                            }}
                        >
                          დახურვა
                        </Button>
                    )}

                  </div>
                </>}
            >

            </Result>
        )}
          <Button
              type="primary"
              style={{
                position: 'fixed',
                bottom: 50,
                right: "50%",
                transform: 'translateX(50%)',
                border: 'none',
                zIndex: 1000,
              }}
              onClick={() => setDrawerVisible(prev => !prev)}>
            <UpOutlined/>
          </Button>
          <Spin
              spinning={loading}
              tip="ვეძებ პროდუქტს..."
              style={{
                background: 'rgba(0, 0, 0, 0.1)',
                borderRadius: 4,
              }}
              size="large"
          >
            <Drawer
                title="პროდუქტის ძიება"
                placement="bottom"
                closable={true}
                open={drawerVisible}
                onClose={() => setDrawerVisible(false)}
            >
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
                </Flex>

              </Form>
              <ScanButton
                  setScanning={() => {
                    setScanning(prev => !prev);
                    setDrawerVisible(false);
                  }}
                  scanning={scanning}
                  onScan={handleScanResult}
                  disabled={disableScan}
                  qrRef={qrRef}
              />

            </Drawer>

          </Spin>
          {!scanning && balances.length > 0 && (
              <>
                <Descriptions>
                  <Descriptions.Item label="პროდუქტი">
                    {productInfo.sku_name}
                  </Descriptions.Item>
                  <Descriptions.Item label="არტიკული">{productInfo.article}</Descriptions.Item>
                </Descriptions>
                <Carousel
                    arrows
                    infinite
                    style={{
                      margin: '0 auto',
                      width: '300px',
                    }}
                >
                  {productInfo.img_url.map((img, index) => (
                      <div key={index}>
                        <img
                            src={img}
                            style={{width: '100%'}}
                        />
                      </div>
                  ))}
                </Carousel>
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

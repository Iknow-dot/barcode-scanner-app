import React, {useState, useEffect, useContext, useRef} from 'react';
import {warehouseService, productService} from '../../api';
import ScanButton from './ScanButton';
import subNavContext from "../../contexts/SubNavContext";
import useAppNotification from "../../hooks/useAppNotification";
import {
    Button,
    Carousel,
    Descriptions, Drawer,
    Flex, Form,
    Input, Result,
    Select,
    Spin,
    Switch,
    Table
} from "antd";
import {BarcodeOutlined, NumberOutlined, SearchOutlined, UpOutlined} from "@ant-design/icons";


const UserDashboard = () => {
    const [drawerVisible, setDrawerVisible] = useState(true);
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);
    const [disableScan, setDisableScan] = useState(false);
    const {setSubNav} = useContext(subNavContext);
    const [scanning, setScanning] = useState(false);
    const [balances, setBalances] = useState([]);
    const [userWarehouses, setUserWarehouses] = useState([]);
    const [productInfo, setProductInfo] = useState({sku_name: '', article: '', price: '', images: []});
    const qrRef = useRef(null);

    const {notify, contextHolder} = useAppNotification();

    useEffect(() => {
        setSubNav(null);
        const fetchWarehouses = async () => {
            const result = await warehouseService.getWarehouses();
            if (result.success) {
                setUserWarehouses(result.data);
            } else {
                console.error("Failed to fetch user warehouses:", result.error);
            }
        };

        fetchWarehouses();
    }, [setSubNav]);

    const handleSearch = async ({search, searchType, allWarehouses}) => {
        setLoading(true);

        const warehouseCodes = allWarehouses
            ? []
            : userWarehouses.map(warehouse => warehouse.code);

        const result = await productService.searchProduct(search, searchType, warehouseCodes);

        if (result.success && result.data?.stock) {
            setBalances(result.data.stock);
            setProductInfo({
                sku_name: result.data.sku_name,
                article: result.data.article,
                price: result.data.price,
                images: result.data.images || []
            });
            setDrawerVisible(false);
        } else {
            setBalances([]);
            setProductInfo({sku_name: '', article: '', price: '', images: []});

            if (!result.success) {
                // Map specific error codes to user-friendly Georgian messages
                const errorMessages = {
                    'PRODUCT_NOT_FOUND': 'პროდუქტი ვერ მოიძებნა ვებ სერვისში',
                    'EXTERNAL_SERVICE_TIMEOUT': 'ვებ სერვისთან კავშირის დრო ამოიწურა. გთხოვთ, სცადოთ მოგვიანებით.',
                    'EXTERNAL_SERVICE_UNAVAILABLE': 'ვებ სერვისთან დაკავშირება ვერ მოხერხდა. გთხოვთ, სცადოთ მოგვიანებით.',
                    'EXTERNAL_SERVICE_ERROR': 'ვებ სერვისთან კომუნიკაციის შეცდომა. გთხოვთ, სცადოთ მოგვიანებით.',
                    'EXTERNAL_SERVICE_UNAUTHORIZED': 'ვებ სერვისზე ავტორიზაცია ვერ მოხერხდა. გთხოვთ, დაუკავშირდით ადმინისტრატორს.',
                };

                const isExternalServiceError = result.code && result.code.startsWith('EXTERNAL_SERVICE_');
                const title = isExternalServiceError ? 'ვებ სერვისის შეცდომა' : 'შეცდომა';
                const errorMessage = errorMessages[result.code] || 'პროდუქტის ძიებისას მოხდა შეცდომა';
                notify.error(title, errorMessage);
            } else {
                notify.warning('შედეგი', 'პროდუქტი ვერ მოიძებნა ან ნაშთი არ არსებობს');
            }
        }

        setLoading(false);
    };

    const handleScanResult = (decodedText) => {
        setScanning(false);
        handleSearch({
            search: decodedText,
            searchType: 'barcode',
            allWarehouses: form.getFieldValue('allWarehouses')
        });
    };

    /**
     * Get the image source from Django's image response format.
     * Django returns images as { original_url, base64 } objects.
     */
    const getImageSrc = (img) => {
        if (typeof img === 'string') return img;
        if (img.base64) return img.base64;
        if (img.original_url) return img.original_url;
        return '';
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
                        <Button type="primary" onClick={() => setDrawerVisible(true)}>
                            ძებნა
                        </Button>
                        <div style={{marginTop: 20}}>
                            <div ref={qrRef} id="qr-reader"/>
                            {scanning && (
                                <Button
                                    variant="outlined"
                                    onClick={() => setScanning(false)}
                                    danger
                                    style={{marginTop: 10}}
                                >
                                    დახურვა
                                </Button>
                            )}
                        </div>
                    </>}
                />
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
                style={{background: 'rgba(0, 0, 0, 0.1)', borderRadius: 4}}
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
                        initialValues={{searchType: 'barcode'}}
                        layout="horizontal"
                    >
                        <Flex gap="middle" justify="center">
                            <Form.Item
                                name="searchType"
                                initialValue="barcode"
                                rules={[{required: true, message: 'გთხოვთ აირჩიოთ ძიების ტიპი!'}]}
                            >
                                <Select
                                    options={[
                                        {label: (<><BarcodeOutlined/> შტრიხკოდი</>), value: "barcode"},
                                        {label: (<><NumberOutlined/> არტიკული</>), value: "article"},
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
                                rules={[{required: true, message: 'გთხოვთ შეიყვანოთ ძიების ტექსტი!'}]}
                            >
                                <Input.Search
                                    placeholder="ძიება"
                                    enterButton={<SearchOutlined/>}
                                    onSearch={form.submit}
                                    allowClear
                                />
                            </Form.Item>
                        </Flex>
                        <Flex gap="middle" justify="center">
                            <Form.Item name="allWarehouses" label="ყველა საწყობი" initialValue={false}>
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
                        <Descriptions.Item label="პროდუქტი">{productInfo.sku_name}</Descriptions.Item>
                        <Descriptions.Item label="არტიკული">{productInfo.article}</Descriptions.Item>
                    </Descriptions>
                    {productInfo.images && productInfo.images.length > 0 && (
                        <Carousel
                            arrows
                            infinite
                            style={{margin: '0 auto', width: '300px'}}
                        >
                            {productInfo.images.map((img, index) => (
                                <div key={index}>
                                    <img
                                        src={getImageSrc(img)}
                                        alt={`Product ${index + 1}`}
                                        style={{width: '100%'}}
                                    />
                                </div>
                            ))}
                        </Carousel>
                    )}
                    <Table
                        dataSource={balances.map((item, idx) => ({...item, key: idx}))}
                        rowClassName={(record) =>
                            userWarehouses.map(wh => wh.name).includes(record.warehouse_name) ? 'highlight-row' : ''
                        }
                        columns={[
                            {title: 'საწყობი', dataIndex: 'warehouse_name', key: 'warehouse_name'},
                            {title: 'ნაშთი', dataIndex: 'quantity', key: 'quantity'},
                            {
                                title: 'ფასი', dataIndex: 'price', key: 'price',
                                render: (price) => <span>{price} ₾</span>
                            },
                        ]}
                    />
                </>
            )}
        </>
    );
};

export default UserDashboard;

import React, {useState, useEffect, useContext, useRef} from 'react';
import {warehouseService, productService} from '../../api';
import ScanButton from './ScanButton';
import subNavContext from "../../contexts/SubNavContext";
import useAppNotification from "../../hooks/useAppNotification";
import {useLanguage} from '../../i18n/LanguageContext';
import {
    Button,
    Card,
    Carousel,
    Descriptions,
    Divider,
    Drawer,
    Empty,
    Flex,
    Form,
    Input,
    Result,
    Select,
    Spin,
    Switch,
    Table,
    Tag,
    Typography
} from "antd";
import {
    BarcodeOutlined,
    NumberOutlined,
    SearchOutlined,
    ShoppingOutlined,
    UpOutlined,
    InboxOutlined
} from "@ant-design/icons";

const {Title, Text} = Typography;

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
    const {t} = useLanguage();

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
                const errorMessages = {
                    'PRODUCT_NOT_FOUND': t.productNotFound,
                    'EXTERNAL_SERVICE_TIMEOUT': t.externalServiceTimeout,
                    'EXTERNAL_SERVICE_UNAVAILABLE': t.externalServiceUnavailable,
                    'EXTERNAL_SERVICE_ERROR': t.externalServiceError,
                    'EXTERNAL_SERVICE_UNAUTHORIZED': t.externalServiceUnauthorized,
                };

                const isExternalServiceError = result.code && result.code.startsWith('EXTERNAL_SERVICE_');
                const title = isExternalServiceError ? t.webServiceError : t.error;
                const errorMessage = errorMessages[result.code] || t.productSearchError;
                notify.error(title, errorMessage);
            } else {
                notify.warning(t.result, t.productNotFoundOrNoBalance);
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

            {/* Empty State - when no results yet */}
            {(balances.length === 0 || scanning) && (
                <div className="empty-state">
                    <Result
                        icon={<ShoppingOutlined style={{color: '#1677ff', fontSize: 64}}/>}
                        title={<span style={{fontSize: 22, fontWeight: 600}}>{t.productSearch}</span>}
                        subTitle={
                            <span style={{fontSize: 14, opacity: 0.6}}>
                                {t.productSearchSubtitle}
                            </span>
                        }
                        extra={
                            <>
                                <Button
                                    type="primary"
                                    size="large"
                                    icon={<SearchOutlined/>}
                                    onClick={() => setDrawerVisible(true)}
                                    style={{borderRadius: 10, height: 44, paddingInline: 28}}
                                >
                                    {t.search}
                                </Button>
                                <div style={{marginTop: 24}}>
                                    <div ref={qrRef} id="qr-reader"/>
                                    {scanning && (
                                        <Button
                                            variant="outlined"
                                            onClick={() => setScanning(false)}
                                            danger
                                            style={{marginTop: 12, borderRadius: 10}}
                                        >
                                            {t.close}
                                        </Button>
                                    )}
                                </div>
                            </>
                        }
                    />
                </div>
            )}

            {/* Toggle Search Drawer Button */}
            {!scanning && balances.length > 0 && (
                <Button
                    type="primary"
                    shape="circle"
                    className="toggle-search-btn"
                    onClick={() => setDrawerVisible(prev => !prev)}
                    icon={<UpOutlined style={{
                        transition: 'transform 0.3s ease',
                        transform: drawerVisible ? 'rotate(180deg)' : 'rotate(0deg)',
                    }}/>}
                />
            )}

            {/* Loading Overlay */}
            <Spin
                spinning={loading}
                tip={t.searchingProduct}
                style={{background: 'rgba(0, 0, 0, 0.05)', borderRadius: 12}}
                size="large"
            >
                {/* Search Drawer */}
                <Drawer
                    title={
                        <Flex align="center" gap={8}>
                            <SearchOutlined style={{fontSize: 18, color: '#1677ff'}}/>
                            <span style={{fontWeight: 600}}>{t.productSearch}</span>
                        </Flex>
                    }
                    placement="bottom"
                    closable={true}
                    open={drawerVisible}
                    onClose={() => setDrawerVisible(false)}
                    className="search-drawer"
                    height="auto"
                    styles={{
                        body: {paddingTop: 16, paddingBottom: 80},
                    }}
                >
                    <Form
                        form={form}
                        onFinish={handleSearch}
                        initialValues={{searchType: 'barcode'}}
                        layout="vertical"
                        style={{maxWidth: 500, margin: '0 auto'}}
                    >
                        <Form.Item
                            name="searchType"
                            label={t.selectSearchType ? undefined : undefined}
                            initialValue="barcode"
                            rules={[{required: true, message: t.selectSearchType}]}
                        >
                            <Select
                                size="large"
                                style={{borderRadius: 10}}
                                options={[
                                    {
                                        label: (
                                            <Flex align="center" gap={8}>
                                                <BarcodeOutlined/> {t.barcode}
                                            </Flex>
                                        ),
                                        value: "barcode"
                                    },
                                    {
                                        label: (
                                            <Flex align="center" gap={8}>
                                                <NumberOutlined/> {t.article}
                                            </Flex>
                                        ),
                                        value: "article"
                                    },
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
                            rules={[{required: true, message: t.enterSearchText}]}
                        >
                            <Input.Search
                                size="large"
                                placeholder={t.searchPlaceholder}
                                enterButton={
                                    <Button type="primary" icon={<SearchOutlined/>}>
                                        {t.search}
                                    </Button>
                                }
                                onSearch={form.submit}
                                allowClear
                                style={{borderRadius: 10}}
                            />
                        </Form.Item>

                        <Flex justify="center" style={{marginTop: 4}}>
                            <Form.Item
                                name="allWarehouses"
                                label={t.allWarehouses}
                                initialValue={false}
                                valuePropName="checked"
                            >
                                <Switch/>
                            </Form.Item>
                        </Flex>
                    </Form>

                    <Flex justify="center" style={{marginTop: 8}}>
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
                    </Flex>
                </Drawer>
            </Spin>

            {/* Product Results */}
            {!scanning && balances.length > 0 && (
                <div style={{animation: 'loginCardSlideUp 0.4s ease-out'}}>
                    {/* Product Info Card */}
                    <Card
                        className="product-result-card"
                        size="small"
                        style={{marginBottom: 16}}
                    >
                        <Flex align="center" gap={16} wrap="wrap">
                            {/* Product Images */}
                            {productInfo.images && productInfo.images.length > 0 && (
                                <div className="product-carousel">
                                    <Carousel
                                        arrows
                                        infinite
                                        autoplay
                                        autoplaySpeed={4000}
                                        style={{width: 200}}
                                    >
                                        {productInfo.images.map((img, index) => (
                                            <div key={index}>
                                                <img
                                                    src={getImageSrc(img)}
                                                    alt={`Product ${index + 1}`}
                                                    style={{
                                                        width: '100%',
                                                        maxHeight: 200,
                                                        objectFit: 'contain',
                                                        borderRadius: 8,
                                                    }}
                                                />
                                            </div>
                                        ))}
                                    </Carousel>
                                </div>
                            )}

                            {/* Product Details */}
                            <div style={{flex: 1, minWidth: 200}}>
                                <Title level={4} style={{margin: '0 0 4px 0'}}>
                                    {productInfo.sku_name}
                                </Title>
                                <Flex gap={8} wrap="wrap" style={{marginTop: 8}}>
                                    <Tag color="blue" style={{fontSize: 13, padding: '2px 10px'}}>
                                        {t.article}: {productInfo.article}
                                    </Tag>
                                    {productInfo.price && (
                                        <Tag color="green" style={{fontSize: 13, padding: '2px 10px'}}>
                                            {productInfo.price} ₾
                                        </Tag>
                                    )}
                                </Flex>
                            </div>
                        </Flex>
                    </Card>

                    {/* Balance Table */}
                    <Card
                        className="balance-table"
                        size="small"
                        title={
                            <Flex align="center" gap={8}>
                                <InboxOutlined style={{color: '#1677ff'}}/>
                                <span style={{fontWeight: 600}}>{t.balance}</span>
                                <Tag style={{marginLeft: 4}}>{balances.length}</Tag>
                            </Flex>
                        }
                    >
                        <Table
                            dataSource={balances.map((item, idx) => ({...item, key: idx}))}
                            rowClassName={(record) =>
                                userWarehouses.map(wh => wh.name).includes(record.warehouse_name) ? 'highlight-row' : ''
                            }
                            size="middle"
                            pagination={balances.length > 10 ? {pageSize: 10} : false}
                            columns={[
                                {
                                    title: t.warehouse,
                                    dataIndex: 'warehouse_name',
                                    key: 'warehouse_name',
                                    render: (name) => (
                                        <Text strong={userWarehouses.map(wh => wh.name).includes(name)}>
                                            {name}
                                        </Text>
                                    ),
                                },
                                {
                                    title: t.balance,
                                    dataIndex: 'quantity',
                                    key: 'quantity',
                                    align: 'right',
                                    render: (qty) => (
                                        <Tag color={qty > 0 ? 'green' : 'default'}
                                             style={{fontWeight: 600, fontSize: 13}}>
                                            {qty}
                                        </Tag>
                                    ),
                                },
                                {
                                    title: t.price,
                                    dataIndex: 'price',
                                    key: 'price',
                                    align: 'right',
                                    render: (price) => (
                                        <Text style={{fontWeight: 500}}>
                                            {price} ₾
                                        </Text>
                                    ),
                                },
                            ]}
                        />
                    </Card>
                </div>
            )}
        </>
    );
};

export default UserDashboard;

import React from 'react';
import {Card, Col, Input, Row, Statistic, Table, Tag, Typography} from 'antd';
import {SearchOutlined} from '@ant-design/icons';
import {useLanguage} from '../../i18n/LanguageContext';

const {Text} = Typography;

// Static preview rendered (blurred) behind the LockedFeature overlay when the
// org's catalog feature is off. Pure demo data — the real endpoints are gated
// server-side, so nothing here fetches.
const DEMO_ROWS = [
    {key: 1, name: 'არომატული სანთელი "ვანილი"', sku: '000000101', article: 'AR-101', category: 'დეკორი / სანთლები', price: '24.50'},
    {key: 2, name: 'კრისტალის ვაზა 25სმ', sku: '000000102', article: 'VZ-025', category: 'დეკორი / ვაზები', price: '89.00'},
    {key: 3, name: 'ჭურჭლის ნაკრები 12 ცალი', sku: '000000103', article: 'DN-012', category: 'სამზარეულო / ჭურჭელი', price: '159.90'},
    {key: 4, name: 'ბამბის პლედი 150x200', sku: '000000104', article: 'PL-150', category: 'ტექსტილი / პლედები', price: '74.00'},
    {key: 5, name: 'კერამიკული ქოთანი "ტერა"', sku: '000000105', article: 'KT-201', category: 'ბაღი / ქოთნები', price: '32.00'},
];

const CatalogDemo = () => {
    const {t} = useLanguage();

    const columns = [
        {title: t.name, dataIndex: 'name', key: 'name', render: (v) => <Text strong>{v}</Text>},
        {title: t.colSku, dataIndex: 'sku', key: 'sku', render: (v) => <Text type="secondary">{v}</Text>},
        {title: t.article, dataIndex: 'article', key: 'article'},
        {title: t.colCategory, dataIndex: 'category', key: 'category'},
        {title: t.colPrice, dataIndex: 'price', key: 'price', align: 'right', render: (v) => `${v} ₾`},
        {title: '', key: 'is_active', width: 100, render: () => <Tag color="green">{t.statusActive}</Tag>},
    ];

    return (
        <div>
            <Card style={{marginBottom: 16}}>
                <Row gutter={16}>
                    <Col xs={12} sm={6}><Statistic title={t.productsCount} value={1248}/></Col>
                    <Col xs={12} sm={6}><Statistic title={t.receivedCount} value={1248}/></Col>
                    <Col xs={12} sm={6}><Statistic title={t.upsertedCount} value={37}/></Col>
                    <Col xs={12} sm={6}><Statistic title={t.imagesFailedCount} value={0}/></Col>
                </Row>
            </Card>
            <Card>
                <Input
                    prefix={<SearchOutlined/>}
                    placeholder={t.searchCatalog || ''}
                    style={{maxWidth: 320, marginBottom: 16}}
                    readOnly
                />
                <Table
                    columns={columns}
                    dataSource={DEMO_ROWS}
                    pagination={false}
                    size="middle"
                />
            </Card>
        </div>
    );
};

export default CatalogDemo;

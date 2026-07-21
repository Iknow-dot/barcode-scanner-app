import React, {useState, useEffect, useCallback, useRef} from 'react';
import {catalogService} from '../../api/services/catalogService';
import {useLanguage} from '../../i18n/LanguageContext';
import useAppNotification from '../../hooks/useAppNotification';
import formatRelativeTime from '../../utils/formatRelativeTime';
import {
    Table, Card, Tag, Input, Segmented, Button, Drawer, Descriptions,
    Image, Space, Flex, Typography, Statistic, Empty, Row, Col,
} from 'antd';
import {ReloadOutlined, SearchOutlined, DatabaseOutlined} from '@ant-design/icons';

const {Text, Title} = Typography;

const HEALTH_TAG = (health, t) => {
    const map = {
        ok: {color: 'green', label: t.syncHealthy},
        stale: {color: 'gold', label: t.syncStale},
        error: {color: 'red', label: t.syncErrorLabel},
        never: {color: 'default', label: t.syncNever},
    };
    return map[health] || map.never;
};

const fmtTime = (iso, t) => (iso ? formatRelativeTime(new Date(iso).getTime(), t) : '—');

const CatalogTab = () => {
    const {t} = useLanguage();
    const {notify, contextHolder} = useAppNotification();

    const [status, setStatus] = useState(null);
    const [rows, setRows] = useState([]);
    const [count, setCount] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [q, setQ] = useState('');
    const [activeFilter, setActiveFilter] = useState('all'); // all | active | inactive
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState(null);
    const debounceRef = useRef(null);

    const fetchStatus = useCallback(async () => {
        const res = await catalogService.syncStatus();
        if (res.success) setStatus(res.data);
    }, []);

    const fetchList = useCallback(async (opts = {}) => {
        setLoading(true);
        const params = {page: opts.page ?? page, page_size: opts.pageSize ?? pageSize};
        const query = opts.q ?? q;
        if (query) params.q = query;
        const filter = opts.activeFilter ?? activeFilter;
        if (filter === 'active') params.is_active = true;
        if (filter === 'inactive') params.is_active = false;
        try {
            const res = await catalogService.listProducts(params);
            if (res.success) {
                const data = res.data;
                setRows((data.results || []).map((r) => ({...r, key: r.sku})));
                setCount(typeof data.count === 'number' ? data.count : (data.results || []).length);
            } else {
                notify.error(t.error, t.dataFetchError);
            }
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, q, activeFilter, notify, t]);

    useEffect(() => {
        fetchStatus();
        fetchList({page: 1});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Debounced search
    const onSearchChange = (value) => {
        setQ(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setPage(1);
            fetchList({q: value, page: 1});
        }, 400);
    };

    const onFilterChange = (value) => {
        setActiveFilter(value);
        setPage(1);
        fetchList({activeFilter: value, page: 1});
    };

    const onTableChange = (pagination) => {
        setPage(pagination.current);
        setPageSize(pagination.pageSize);
        fetchList({page: pagination.current, pageSize: pagination.pageSize});
    };

    const refresh = () => {
        fetchStatus();
        fetchList();
    };

    const tag = HEALTH_TAG(status?.health, t);
    const lastPushIso = status?.last_delta_push_at || status?.last_full_push_at;

    const columns = [
        {
            title: t.colImage, key: 'image', width: 64,
            render: (_, r) => (r.images && r.images[0]
                ? <Image src={catalogService.imageUrl(r.images[0])} width={40} height={40}
                         style={{objectFit: 'cover', borderRadius: 6}} preview={false}/>
                : <div style={{width: 40, height: 40, borderRadius: 6, background: 'rgba(0,0,0,0.05)'}}/>),
        },
        {title: t.name, dataIndex: 'name', key: 'name', render: (v) => <Text strong>{v}</Text>},
        {title: t.colSku, dataIndex: 'sku', key: 'sku', render: (v) => <Text type="secondary">{v}</Text>},
        {title: t.article, dataIndex: 'article', key: 'article'},
        {
            title: t.colCategory, dataIndex: 'category_path', key: 'category_path',
            render: (path) => (path && path.length ? path.join(' › ') : <Text type="secondary">—</Text>),
        },
        {
            title: t.colPrice, dataIndex: 'price', key: 'price', align: 'right',
            render: (p) => (p != null ? `${p} ₾` : '—'),
        },
        {
            title: '', dataIndex: 'is_active', key: 'is_active', width: 100,
            render: (a) => <Tag color={a ? 'green' : 'default'}>{a ? t.statusActive : t.statusInactive}</Tag>,
        },
        {
            title: t.colUpdated, dataIndex: 'pushed_at', key: 'pushed_at', width: 130,
            render: (d) => <Text type="secondary" style={{fontSize: 12}}>{fmtTime(d, t)}</Text>,
        },
    ];

    return (
        <>
            {contextHolder}

            {/* Sync status panel */}
            <Card size="small" style={{marginBottom: 16}}>
                <Flex justify="space-between" align="center" wrap="wrap" gap={12}>
                    <Space size={12} align="center">
                        <DatabaseOutlined style={{fontSize: 20, color: '#1677ff'}}/>
                        <Title level={5} style={{margin: 0}}>{t.syncStatusTitle}</Title>
                        <Tag color={tag.color}>{tag.label}</Tag>
                        <Text type="secondary">{t.lastPush}: {fmtTime(lastPushIso, t)}</Text>
                    </Space>
                    <Button icon={<ReloadOutlined/>} onClick={refresh} loading={loading}>{t.refreshData}</Button>
                </Flex>
                <Row gutter={16} style={{marginTop: 16}}>
                    <Col xs={12} sm={6}><Statistic title={t.productsCount} value={status?.active_product_count ?? 0}/></Col>
                    <Col xs={12} sm={6}><Statistic title={t.receivedCount} value={status?.received ?? 0}/></Col>
                    <Col xs={12} sm={6}><Statistic title={t.upsertedCount} value={status?.upserted ?? 0}/></Col>
                    <Col xs={12} sm={6}><Statistic title={t.imagesFailedCount} value={status?.images_failed ?? 0}/></Col>
                </Row>
                {status?.health === 'error' && status?.last_error && (
                    <div style={{marginTop: 12}}>
                        <Text type="danger">{t.lastErrorLabel}: {status.last_error}</Text>
                    </div>
                )}
            </Card>

            {/* Search + filter */}
            <Flex gap={12} wrap="wrap" align="center" style={{marginBottom: 12}}>
                <Input
                    placeholder={t.searchCatalog}
                    prefix={<SearchOutlined style={{opacity: 0.4}}/>}
                    allowClear
                    value={q}
                    onChange={(e) => onSearchChange(e.target.value)}
                    style={{maxWidth: 360, flex: '1 1 240px'}}
                />
                <Segmented
                    value={activeFilter}
                    onChange={onFilterChange}
                    options={[
                        {label: t.catalogAll, value: 'all'},
                        {label: t.catalogActiveOnly, value: 'active'},
                        {label: t.catalogInactiveOnly, value: 'inactive'},
                    ]}
                />
            </Flex>

            {/* Product table (server-side pagination) */}
            <Table
                dataSource={rows}
                columns={columns}
                loading={loading}
                size="middle"
                scroll={{x: 'max-content'}}
                onRow={(record) => ({onClick: () => setSelected(record), style: {cursor: 'pointer'}})}
                onChange={onTableChange}
                pagination={{
                    current: page, pageSize, total: count,
                    showSizeChanger: true, pageSizeOptions: ['25', '50', '100'],
                }}
                locale={{emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t.noProductsFound}/>}}
            />

            {/* Detail drawer */}
            <Drawer
                title={selected ? selected.name : t.productDetails}
                open={!!selected}
                onClose={() => setSelected(null)}
                width={420}
            >
                {selected && (
                    <>
                        {selected.images && selected.images.length > 0 && (
                            <Image.PreviewGroup>
                                <Space wrap>
                                    {selected.images.map((img, i) => (
                                        <Image key={i} src={catalogService.imageUrl(img)} width={90} height={90}
                                               style={{objectFit: 'cover', borderRadius: 8}}/>
                                    ))}
                                </Space>
                            </Image.PreviewGroup>
                        )}
                        <Descriptions column={1} size="small" style={{marginTop: 16}} bordered>
                            <Descriptions.Item label={t.colSku}>{selected.sku}</Descriptions.Item>
                            <Descriptions.Item label={t.article}>{selected.article || '—'}</Descriptions.Item>
                            <Descriptions.Item label={t.colPrice}>{selected.price != null ? `${selected.price} ₾` : '—'}</Descriptions.Item>
                            <Descriptions.Item label={t.colCategory}>
                                {selected.category_path && selected.category_path.length ? selected.category_path.join(' › ') : '—'}
                            </Descriptions.Item>
                            <Descriptions.Item label={''}>
                                <Tag color={selected.is_active ? 'green' : 'default'}>
                                    {selected.is_active ? t.statusActive : t.statusInactive}
                                </Tag>
                            </Descriptions.Item>
                        </Descriptions>

                        <Title level={5} style={{marginTop: 20}}>{t.attributesLabel}</Title>
                        {selected.attributes && selected.attributes.length > 0 ? (
                            <Descriptions column={1} size="small" bordered>
                                {selected.attributes.map((a) => (
                                    <Descriptions.Item key={a.key} label={a.label}>{String(a.value)}</Descriptions.Item>
                                ))}
                            </Descriptions>
                        ) : <Text type="secondary">{t.noAttributes}</Text>}

                        <Title level={5} style={{marginTop: 20}}>{t.barcodesLabel}</Title>
                        <Space wrap>
                            {(selected.barcodes || []).map((b) => <Tag key={b}>{b}</Tag>)}
                            {(!selected.barcodes || selected.barcodes.length === 0) && <Text type="secondary">—</Text>}
                        </Space>
                    </>
                )}
            </Drawer>
        </>
    );
};

export default CatalogTab;

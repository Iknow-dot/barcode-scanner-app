import React, {useState, useEffect, useCallback, useRef, useMemo} from 'react';
import {catalogService} from '../../api/services/catalogService';
import {useLanguage} from '../../i18n/LanguageContext';
import useAppNotification from '../../hooks/useAppNotification';
import formatRelativeTime from '../../utils/formatRelativeTime';
import {toCascaderOptions, categoryPathLabels} from './cascaderOptions';
import {
    Table, Card, Tag, Input, InputNumber, DatePicker, Popover, Cascader, Segmented, Button,
    Drawer, Descriptions, Image, Space, Flex, Typography, Statistic, Empty, Row, Col,
} from 'antd';
import {ReloadOutlined, SearchOutlined, DatabaseOutlined, FilterOutlined} from '@ant-design/icons';

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

const EMPTY_FILTERS = {price_min: null, price_max: null, dates: null, attrs: {}};

const CatalogTab = () => {
    const {t} = useLanguage();
    const {notify, contextHolder} = useAppNotification();

    const [status, setStatus] = useState(null);
    const [tree, setTree] = useState([]);            // raw category-tree nodes
    const [categoryPath, setCategoryPath] = useState([]); // Cascader value: ids root→selected
    const [rows, setRows] = useState([]);
    const [count, setCount] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [q, setQ] = useState('');
    const [activeFilter, setActiveFilter] = useState('all');
    // Draft = popover inputs; applied = what the server currently filters by.
    const [draft, setDraft] = useState(EMPTY_FILTERS);
    const [applied, setApplied] = useState(EMPTY_FILTERS);
    const [filterOpen, setFilterOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState(null);
    const debounceRef = useRef(null);

    const category = categoryPath.length ? categoryPath[categoryPath.length - 1] : null;
    const cascaderOpts = useMemo(() => toCascaderOptions(tree), [tree]);

    const fetchStatus = useCallback(async () => {
        const res = await catalogService.syncStatus();
        if (res.success) setStatus(res.data);
    }, []);

    const fetchTree = useCallback(async () => {
        const res = await catalogService.categoryTree();
        if (res.success) setTree(res.data || []);
    }, []);

    const buildParams = useCallback((opts = {}) => {
        const params = {page: opts.page ?? page, page_size: opts.pageSize ?? pageSize};
        const query = opts.q ?? q;
        if (query) params.q = query;
        const filter = opts.activeFilter ?? activeFilter;
        if (filter === 'active') params.is_active = true;
        if (filter === 'inactive') params.is_active = false;
        const cat = opts.category !== undefined ? opts.category : category;
        if (cat) params.category = cat;
        const f = opts.filters ?? applied;
        if (f.price_min != null) params.price_min = f.price_min;
        if (f.price_max != null) params.price_max = f.price_max;
        if (f.dates && f.dates[0]) params.pushed_after = f.dates[0].format('YYYY-MM-DD');
        if (f.dates && f.dates[1]) params.pushed_before = f.dates[1].format('YYYY-MM-DD');
        Object.entries(f.attrs || {}).forEach(([k, v]) => {
            if (v) params[`attr_${k}`] = v;
        });
        return params;
    }, [page, pageSize, q, activeFilter, category, applied]);

    const fetchList = useCallback(async (opts = {}) => {
        setLoading(true);
        try {
            const res = await catalogService.listProducts(buildParams(opts));
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
    }, [buildParams, notify, t]);

    useEffect(() => {
        fetchStatus();
        fetchTree();
        fetchList({page: 1});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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

    const onCategoryChange = (path) => {
        const next = path || [];
        setCategoryPath(next);
        setPage(1);
        fetchList({category: next.length ? next[next.length - 1] : null, page: 1});
    };

    const onTableChange = (pagination) => {
        setPage(pagination.current);
        setPageSize(pagination.pageSize);
        fetchList({page: pagination.current, pageSize: pagination.pageSize});
    };

    const applyFilters = () => {
        setApplied(draft);
        setFilterOpen(false);
        setPage(1);
        fetchList({filters: draft, page: 1});
    };

    const clearFilters = () => {
        setDraft(EMPTY_FILTERS);
        setApplied(EMPTY_FILTERS);
        setFilterOpen(false);
        setPage(1);
        fetchList({filters: EMPTY_FILTERS, page: 1});
    };

    const removeFilter = (patch) => {
        const next = {...applied, ...patch, attrs: {...applied.attrs, ...(patch.attrs || {})}};
        if (patch.attrs) {
            next.attrs = {...applied.attrs};
            Object.keys(patch.attrs).forEach((k) => delete next.attrs[k]);
        }
        setDraft(next);
        setApplied(next);
        setPage(1);
        fetchList({filters: next, page: 1});
    };

    const refresh = () => {
        fetchStatus();
        fetchTree();
        fetchList();
    };

    const tag = HEALTH_TAG(status?.health, t);
    const lastPushIso = status?.last_delta_push_at || status?.last_full_push_at;
    const visibleAttrs = status?.visible_attributes || [];

    const activeFilterTags = [];
    if (applied.price_min != null) activeFilterTags.push({label: `${t.priceMinLabel}: ${applied.price_min}`, patch: {price_min: null}});
    if (applied.price_max != null) activeFilterTags.push({label: `${t.priceMaxLabel}: ${applied.price_max}`, patch: {price_max: null}});
    if (applied.dates) activeFilterTags.push({label: `${t.updatedRangeLabel}`, patch: {dates: null}});
    Object.entries(applied.attrs || {}).forEach(([k, v]) => {
        if (!v) return;
        const meta = visibleAttrs.find((a) => a.key === k);
        activeFilterTags.push({label: `${meta?.label || k}: ${v}`, patch: {attrs: {[k]: undefined}}});
    });

    const filterPanel = (
        <div style={{width: 280}}>
            <Space direction="vertical" style={{width: '100%'}} size={10}>
                <Space.Compact style={{width: '100%'}}>
                    <InputNumber placeholder={t.priceMinLabel} min={0} style={{width: '50%'}}
                                 value={draft.price_min}
                                 onChange={(v) => setDraft((d) => ({...d, price_min: v}))}/>
                    <InputNumber placeholder={t.priceMaxLabel} min={0} style={{width: '50%'}}
                                 value={draft.price_max}
                                 onChange={(v) => setDraft((d) => ({...d, price_max: v}))}/>
                </Space.Compact>
                <DatePicker.RangePicker style={{width: '100%'}} value={draft.dates}
                                        onChange={(dates) => setDraft((d) => ({...d, dates}))}/>
                {visibleAttrs.map((a) => (
                    <Input key={a.key} placeholder={a.label || a.key} allowClear
                           value={draft.attrs[a.key] || ''}
                           onChange={(e) => setDraft((d) => ({...d, attrs: {...d.attrs, [a.key]: e.target.value}}))}/>
                ))}
                <Flex justify="space-between">
                    <Button size="small" onClick={clearFilters}>{t.clearFilters}</Button>
                    <Button size="small" type="primary" onClick={applyFilters}>{t.applyFilters}</Button>
                </Flex>
            </Space>
        </div>
    );

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

            <div style={{width: '100%'}}>
                <Flex gap={12} wrap="wrap" align="center" style={{marginBottom: 12}}>
                    <Input
                        placeholder={t.searchCatalog}
                        prefix={<SearchOutlined style={{opacity: 0.4}}/>}
                        allowClear
                        value={q}
                        onChange={(e) => onSearchChange(e.target.value)}
                        style={{maxWidth: 360, flex: '1 1 240px'}}
                    />
                    <Cascader
                        options={cascaderOpts}
                        value={categoryPath}
                        onChange={onCategoryChange}
                        changeOnSelect
                        showSearch
                        allowClear
                        placeholder={t.allCategories}
                        style={{minWidth: 220}}
                    />
                    <Popover content={filterPanel} trigger="click" open={filterOpen}
                             onOpenChange={setFilterOpen} placement="bottomLeft">
                        <Button icon={<FilterOutlined/>}>
                            {t.filtersLabel}{activeFilterTags.length ? ` (${activeFilterTags.length})` : ''}
                        </Button>
                    </Popover>
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

                {(category || activeFilterTags.length > 0) && (
                    <Space wrap style={{marginBottom: 12}}>
                        {category && (
                            <Tag closable onClose={(e) => {
                                e.preventDefault();
                                onCategoryChange([]);
                            }}>
                                {t.colCategory}: {(categoryPathLabels(tree, category) || []).join(' / ')}
                            </Tag>
                        )}
                        {activeFilterTags.map((f) => (
                            <Tag key={f.label} closable onClose={(e) => {
                                e.preventDefault();
                                removeFilter(f.patch);
                            }}>{f.label}</Tag>
                        ))}
                    </Space>
                )}

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
            </div>

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

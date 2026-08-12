import React, {useState, useEffect, useMemo, useCallback, useRef} from 'react';
import {Button, Drawer, Empty, Flex, Input, Spin, Switch, Tag, Typography} from 'antd';
import {LeftOutlined, PictureOutlined, QrcodeOutlined, SearchOutlined, ShoppingCartOutlined} from '@ant-design/icons';
import {catalogService} from '../../api';
import {useLanguage} from '../../i18n/LanguageContext';
import {childrenForStack, nodeForStack, breadcrumbForStack, parentStack, subPath} from './catalogBrowse';
import ProductImage from '../Common/ProductImage';
import './FindProductDrawer.css';
import {TILE_PALETTE, paletteIndex, monogram} from './categoryTileStyle';

const {Text} = Typography;

const PAGE_SIZE = 25;

// 56px thumb with a built-in placeholder: the ProductImage overlays the tinted
// box when it loads; a missing src or a failed load (ProductImage renders
// nothing then) leaves the placeholder visible. ProductImage stays unchanged.
const RowThumb = ({item}) => {
    const src = item.image || (item.images && item.images[0]);
    return (
        <div className="fpd-thumb">
            <PictureOutlined/>
            {src ? (
                <ProductImage
                    src={catalogService.imageUrl(src)}
                    alt={item.name}
                    className="fpd-thumb-img"
                />
            ) : null}
        </div>
    );
};

// Unified "Find product" drawer: a smart search box (name / article / sku /
// barcode typeahead) on top, drill-down category browsing below. Replaces the
// old barcode/article search drawer, the inline name-search field, and the
// separate category-browse drawer.
const FindProductDrawer = ({
    open,
    onClose,
    onSelectProduct,
    onScan,
    allWarehouses,
    onAllWarehousesChange,
    orderMode,
}) => {
    const {t} = useLanguage();
    const inputRef = useRef(null);

    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);

    const [tree, setTree] = useState([]);
    const [treeLoaded, setTreeLoaded] = useState(false);
    // Drill-down position: array of category ids root→current; [] = root.
    const [stack, setStack] = useState([]);
    const [rows, setRows] = useState([]);
    const [count, setCount] = useState(0);
    const [page, setPage] = useState(1);
    const [browseLoading, setBrowseLoading] = useState(false);

    // Monotonic tokens guarding against out-of-order async responses: a
    // response only lands if no newer request superseded it.
    const browseSeqRef = useRef(0);
    const searchSeqRef = useRef(0);

    // Lazy-load the category tree the first time the drawer opens.
    useEffect(() => {
        if (!open || treeLoaded) return;
        let cancelled = false;
        (async () => {
            const res = await catalogService.categoryTree();
            if (!cancelled && res.success) {
                setTree(res.data || []);
                setTreeLoaded(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [open, treeLoaded]);

    // Debounced smart search — same 300ms pattern as the old name search.
    useEffect(() => {
        const trimmed = query.trim();
        if (!trimmed) {
            searchSeqRef.current += 1;
            setResults([]);
            setSearchLoading(false);
            return;
        }
        // The debounce window counts as loading — otherwise the first
        // keystroke shows the "no results" empty state for 300ms.
        setSearchLoading(true);
        const handle = setTimeout(async () => {
            const seq = ++searchSeqRef.current;
            try {
                const res = await catalogService.searchByName(trimmed);
                if (seq !== searchSeqRef.current) return;
                setResults(res.success && Array.isArray(res.data) ? res.data : []);
            } finally {
                if (seq === searchSeqRef.current) setSearchLoading(false);
            }
        }, 300);
        return () => clearTimeout(handle);
    }, [query]);

    const currentId = stack.length ? stack[stack.length - 1] : null;

    const fetchProducts = useCallback(async (categoryId, pageNum) => {
        const seq = ++browseSeqRef.current;
        setBrowseLoading(true);
        try {
            const res = await catalogService.listProducts({
                category: categoryId, page: pageNum, page_size: PAGE_SIZE,
            });
            if (seq !== browseSeqRef.current) return;
            if (res.success) {
                const list = res.data.results || [];
                setRows((prev) => (pageNum === 1 ? list : [...prev, ...list]));
                setCount(res.data.count ?? list.length);
                setPage(pageNum);
            }
        } finally {
            if (seq === browseSeqRef.current) setBrowseLoading(false);
        }
    }, []);

    // (Re)load the branch's products whenever the drill-down position moves.
    // At the root there is no product list (it would be the whole catalog).
    useEffect(() => {
        setRows([]);
        setCount(0);
        setPage(1);
        if (currentId != null) {
            fetchProducts(currentId, 1);
        } else {
            // Ascending to the root starts no new fetch, so invalidate any
            // in-flight one — its late response must not repopulate rows.
            browseSeqRef.current += 1;
            setBrowseLoading(false);
        }
    }, [currentId, fetchProducts]);

    const children = useMemo(() => childrenForStack(tree, stack), [tree, stack]);
    const crumb = useMemo(() => breadcrumbForStack(tree, stack), [tree, stack]);
    const parentNode = useMemo(() => nodeForStack(tree, parentStack(stack)), [tree, stack]);
    const currentNode = useMemo(() => nodeForStack(tree, stack), [tree, stack]);

    const searching = query.trim().length > 0;

    const handleSelect = (sku) => {
        setQuery('');
        setResults([]);
        onSelectProduct(sku);
    };

    const focusInput = (visible) => {
        if (visible && inputRef.current) inputRef.current.focus();
    };

    const renderProductRow = (item, meta) => (
        <div key={item.sku} className="fpd-row" onClick={() => handleSelect(item.sku)}>
            <RowThumb item={item}/>
            <div className="fpd-row-main">
                <div className="fpd-row-name">{item.name}</div>
                {meta ? <div className="fpd-row-meta">{meta}</div> : null}
            </div>
            <div className="fpd-row-side">
                {item.price != null && <span className="fpd-row-price">{item.price} ₾</span>}
                <span className="fpd-row-add" aria-hidden="true">+</span>
            </div>
        </div>
    );

    return (
        <Drawer
            title={
                <Flex align="center" gap={8}>
                    <SearchOutlined style={{fontSize: 18, color: '#1677ff'}}/>
                    <span style={{fontWeight: 600}}>{t.productSearch}</span>
                    {orderMode && (
                        <Tag color="blue" style={{marginLeft: 8}}>
                            <ShoppingCartOutlined/> {t.orderMode}
                        </Tag>
                    )}
                </Flex>
            }
            placement="bottom"
            height="85%"
            closable
            open={open}
            onClose={onClose}
            className="search-drawer"
            afterOpenChange={focusInput}
            styles={{body: {paddingTop: 12, paddingBottom: 24}}}
        >
            <div style={{maxWidth: 500, margin: '0 auto'}}>
                <Flex gap={8}>
                    <Input
                        ref={inputRef}
                        size="large"
                        placeholder={t.findProductPlaceholder}
                        prefix={<SearchOutlined style={{opacity: 0.4}}/>}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        allowClear
                    />
                    <Button
                        size="large"
                        icon={<QrcodeOutlined/>}
                        onClick={onScan}
                        style={{flex: 'none'}}
                    >
                        {t.scanInstead || t.scan}
                    </Button>
                </Flex>

                <Flex justify="space-between" align="center" style={{margin: '10px 2px 6px'}}>
                    <Text type="secondary" style={{fontSize: 13}}>{t.allWarehouses}</Text>
                    <Switch checked={allWarehouses} onChange={onAllWarehousesChange}/>
                </Flex>

                {searching ? (
                    <Spin spinning={searchLoading} size="small">
                        {results.length === 0 && !searchLoading ? (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description={<Text type="secondary" style={{fontSize: 13}}>{t.noResults}</Text>}
                                style={{margin: '24px 0'}}
                            />
                        ) : (
                            <div>
                                {results.map((item) => renderProductRow(item,
                                    [item.article, (item.category_path || []).join(' › ')]
                                        .filter(Boolean).join(' · ')))}
                            </div>
                        )}
                    </Spin>
                ) : (
                    <>
                        {stack.length === 0 ? (
                            <>
                                <div className="fpd-seccap">{t.categoriesLabel}</div>
                                <div className="fpd-tiles">
                                    {children.map((node) => {
                                        const palette = TILE_PALETTE[paletteIndex(node.id)];
                                        return (
                                            <button
                                                type="button"
                                                key={node.id}
                                                className="fpd-tile"
                                                style={{background: palette.bg}}
                                                onClick={() => setStack([...stack, node.id])}
                                            >
                                                <span className="fpd-tile-mono" style={{color: palette.fg}} aria-hidden="true">
                                                    {monogram(node.name)}
                                                </span>
                                                <span className="fpd-tile-name">{node.name}</span>
                                                <span className="fpd-tile-count">
                                                    {node.product_count} {t.productCountSuffix}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </>
                        ) : (
                            <>
                                {stack.length >= 2 && (
                                    <div className="fpd-crumbpath">
                                        {[t.allCategories, ...crumb].join(' › ')}
                                    </div>
                                )}
                                <div className="fpd-crumbline">
                                    <button
                                        type="button"
                                        className="fpd-backpill"
                                        onClick={() => setStack(parentStack(stack))}
                                    >
                                        <LeftOutlined/> {parentNode ? parentNode.name : t.allCategories}
                                    </button>
                                    <span className="fpd-crumbtitle">{currentNode ? currentNode.name : ''}</span>
                                    {currentNode != null && (
                                        <span className="fpd-crumbcount">
                                            {currentNode.product_count} {t.productCountSuffix}
                                        </span>
                                    )}
                                </div>
                                {children.length > 0 && (
                                    <div className="fpd-chips">
                                        {children.map((node) => (
                                            <button
                                                type="button"
                                                key={node.id}
                                                className="fpd-chip"
                                                onClick={() => setStack([...stack, node.id])}
                                            >
                                                {node.name} <span className="fpd-chip-cnt">{node.product_count}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <div style={{marginTop: 8}}>
                                    <Spin spinning={browseLoading} size="small">
                                        {rows.length === 0 && !browseLoading ? (
                                            <Empty
                                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                                description={t.noProductsFound}
                                                style={{margin: '16px 0'}}
                                            />
                                        ) : (
                                            <>
                                                <div>
                                                    {rows.map((item) => renderProductRow(item,
                                                        [item.article, subPath(item.category_path, crumb)]
                                                            .filter(Boolean).join(' · ')))}
                                                </div>
                                                {rows.length < count && (
                                                    <Button
                                                        block
                                                        onClick={() => fetchProducts(currentId, page + 1)}
                                                        loading={browseLoading}
                                                        style={{marginTop: 8}}
                                                    >
                                                        {t.loadMore}
                                                    </Button>
                                                )}
                                            </>
                                        )}
                                    </Spin>
                                </div>
                            </>
                        )}
                    </>
                )}
            </div>
        </Drawer>
    );
};

export default FindProductDrawer;

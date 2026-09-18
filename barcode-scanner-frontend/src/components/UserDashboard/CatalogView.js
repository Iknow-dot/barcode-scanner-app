import React, {useState, useEffect, useMemo, useCallback, useRef} from 'react';
import {Input, Switch} from 'antd';
import {PictureOutlined} from '@ant-design/icons';
import {catalogService} from '../../api';
import {useLanguage} from '../../i18n/LanguageContext';
import {childrenForStack, nodeForStack, breadcrumbForStack, parentStack, subPath} from './catalogBrowse';
import ProductImage from '../Common/ProductImage';
import IosIcon from '../Common/IosIcon';
import {TILE_PALETTE, paletteIndex, monogram} from './categoryTileStyle';
import './CatalogView.css';

const PAGE_SIZE = 25;

// 56px thumb with a built-in placeholder: the ProductImage overlays the tinted
// box when it loads; a missing src or a failed load (ProductImage renders
// nothing then) leaves the placeholder visible. ProductImage stays unchanged
// (phase 5c constraint) — ported from FindProductDrawer.js's RowThumb as-is,
// only the wrapper class names changed (cv- prefix, this file's own CSS).
const RowThumb = ({item}) => {
    const src = item.image || (item.images && item.images[0]);
    return (
        <div className="cv-thumb">
            <PictureOutlined/>
            {src ? (
                <ProductImage
                    src={catalogService.imageUrl(src)}
                    alt={item.name}
                    className="cv-thumb-img"
                />
            ) : null}
        </div>
    );
};

/**
 * The catalog as a full tab screen (iOS redesign phase 5c, task 1) — the same
 * smart search (name/article/sku/barcode typeahead) plus drill-down category
 * browsing FindProductDrawer.js offered in a bottom Drawer, now a screen that
 * sits alongside the tab bar and the active-order bar instead of covering
 * them. FindProductDrawer.js/.css/.test.js are kept working and untouched —
 * a later task deletes them — this file ports their behaviour rather than
 * rewriting it:
 *   - browseSeqRef / searchSeqRef: two independent monotonic sequence
 *     guards, so an out-of-order async response never overwrites a newer
 *     one. Ascending to the root (currentId becomes null) invalidates any
 *     in-flight browse fetch without starting a new one — there is nothing
 *     to fetch at the root (it would be the whole catalog).
 *   - the 300ms search debounce (unchanged: FindProductDrawer.js has no
 *     minimum query length despite this task's brief claiming one — its own
 *     test file fires a search off a 2-character 'pe' probe, so no such gate
 *     was ported; see the task report).
 *   - PAGE_SIZE = 25 and "load more" appending a page's rows onto `rows`
 *     rather than replacing them.
 *   - treeLoaded: the category tree is fetched once, the first time this
 *     component is mounted, never again.
 *
 * `resetToken` stands in for the Drawer's open/close lifecycle: this screen
 * has no `open` prop to hang an `afterOpenChange` off of — it mounts once
 * and, per the task-2 wiring this component expects, stays mounted while the
 * consultant tabs elsewhere. The parent is expected to bump `resetToken` both
 * the first time this tab becomes active and again on every re-tap while
 * already on it; either way the field refocuses and the browse position pops
 * back to the category root with the search cleared. Because React runs
 * every effect on initial mount regardless of its dependency list, one
 * effect keyed on [resetToken] covers both cases without an explicit
 * "active" prop. Nothing here refocuses on a plain re-render (a fetch
 * resolving, a keystroke) — only a resetToken change does — so typing is
 * never interrupted mid-word.
 */
const CatalogView = ({
    orderMode,
    onSelectProduct,
    onScan,
    allWarehouses,
    onAllWarehousesChange,
    resetToken,
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

    // Lazy-load the category tree once, the first time this screen mounts.
    useEffect(() => {
        if (treeLoaded) return;
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
    }, [treeLoaded]);

    // Debounced smart search — same 300ms pattern as FindProductDrawer.js.
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

    // Pop back to the category root, clear the search and refocus the field
    // — both the first time this screen becomes active and on every re-tap
    // of its tab while already on it (task 2 bumps resetToken for both).
    useEffect(() => {
        setStack([]);
        setQuery('');
        inputRef.current?.focus();
    }, [resetToken]);

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

    const renderProductRow = (item, meta) => (
        <button
            type="button"
            key={item.sku}
            className="if-row cv-product-row"
            onClick={() => handleSelect(item.sku)}
        >
            <RowThumb item={item}/>
            <span className="if-row-main">
                <span className="if-row-title if-clamp-2">{item.name}</span>
                {meta ? <span className="if-row-subtitle">{meta}</span> : null}
            </span>
            <span className="if-row-trailing">
                {item.price != null && <span className="if-row-title">{item.price} ₾</span>}
                <span className="cv-row-add" aria-hidden="true">+</span>
            </span>
        </button>
    );

    return (
        <div className="m-tab-content">
            <div className="if-large-header">
                <h1 className="if-large-title">{t.catalog}</h1>
            </div>

            <div className="if-search" aria-busy={searchLoading || undefined}>
                <IosIcon name="search" size={18} stroke={2.4}/>
                <Input
                    ref={inputRef}
                    className="if-search-input"
                    variant="borderless"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t.findProductPlaceholder}
                    aria-label={t.findProductPlaceholder}
                />
                <button
                    type="button"
                    className="if-search-trail is-action"
                    aria-label={t.scan}
                    onClick={onScan}
                >
                    <IosIcon name="scan" size={20} stroke={2.2}/>
                </button>
            </div>

            <div className="if-group cv-allwh-group">
                <div className="if-row">
                    <span className="if-row-label">{t.allWarehouses}</span>
                    <Switch
                        checked={allWarehouses}
                        onChange={onAllWarehousesChange}
                        aria-label={t.allWarehouses}
                    />
                </div>
            </div>

            {searching ? (
                <div className="cv-rows">
                    {results.length > 0 ? (
                        <div className="if-group is-thumb-inset">
                            {results.map((item) => renderProductRow(item,
                                [item.article, (item.category_path || []).join(' › ')]
                                    .filter(Boolean).join(' · ')))}
                        </div>
                    ) : searchLoading ? (
                        <div className="if-group if-group-empty" aria-busy="true">
                            <span className="if-spinner"/>
                        </div>
                    ) : (
                        <div className="if-group if-group-empty">{t.noResults}</div>
                    )}
                </div>
            ) : (
                <>
                    {stack.length === 0 ? (
                        <>
                            <h4 className="if-section-header">{t.categoriesLabel}</h4>
                            <div className="cv-tiles">
                                {children.map((node) => {
                                    const palette = TILE_PALETTE[paletteIndex(node.id)];
                                    return (
                                        <button
                                            type="button"
                                            key={node.id}
                                            className="cv-tile"
                                            style={{background: palette.bg}}
                                            onClick={() => setStack([...stack, node.id])}
                                        >
                                            <span className="cv-tile-mono" style={{color: palette.fg}} aria-hidden="true">
                                                {monogram(node.name)}
                                            </span>
                                            <span className="cv-tile-name">{node.name}</span>
                                            <span className="cv-tile-count">
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
                                <div className="cv-crumbpath">
                                    {[t.allCategories, ...crumb].join(' › ')}
                                </div>
                            )}
                            <div className="cv-crumbline">
                                <button
                                    type="button"
                                    className="cv-backpill"
                                    onClick={() => setStack(parentStack(stack))}
                                >
                                    <IosIcon name="back" size={14} stroke={2.4}/> {parentNode ? parentNode.name : t.allCategories}
                                </button>
                                <span className="cv-crumbtitle">{currentNode ? currentNode.name : ''}</span>
                                {currentNode != null && (
                                    <span className="cv-crumbcount">
                                        {currentNode.product_count} {t.productCountSuffix}
                                    </span>
                                )}
                            </div>
                            {children.length > 0 && (
                                <div className="cv-chips">
                                    {children.map((node) => (
                                        <button
                                            type="button"
                                            key={node.id}
                                            className="cv-chip"
                                            onClick={() => setStack([...stack, node.id])}
                                        >
                                            {node.name} <span className="cv-chip-cnt">{node.product_count}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            <div className="cv-rows">
                                {rows.length > 0 ? (
                                    <>
                                        <div className="if-group is-thumb-inset">
                                            {rows.map((item) => renderProductRow(item,
                                                [item.article, subPath(item.category_path, crumb)]
                                                    .filter(Boolean).join(' · ')))}
                                        </div>
                                        {rows.length < count && (
                                            <button
                                                type="button"
                                                className="if-btn if-btn-gray cv-load-more"
                                                onClick={() => fetchProducts(currentId, page + 1)}
                                                disabled={browseLoading}
                                                aria-busy={browseLoading || undefined}
                                            >
                                                {t.loadMore}
                                            </button>
                                        )}
                                    </>
                                ) : browseLoading ? (
                                    <div className="if-group if-group-empty" aria-busy="true">
                                        <span className="if-spinner"/>
                                    </div>
                                ) : (
                                    <div className="if-group if-group-empty">{t.noProductsFound}</div>
                                )}
                            </div>
                        </>
                    )}
                </>
            )}
        </div>
    );
};

export default CatalogView;

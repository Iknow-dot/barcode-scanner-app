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
// (phase 5c constraint) — ported from the deleted FindProductDrawer.js's
// RowThumb as-is, only the wrapper class names changed (cv- prefix, this
// file's own CSS).
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
 * The catalog as a full tab screen (iOS redesign phase 5c) — the same smart
 * search (name/article/sku/barcode typeahead) plus drill-down category
 * browsing the deleted FindProductDrawer.js offered in a bottom Drawer, now
 * a screen that sits alongside the tab bar and the active-order bar instead
 * of covering them. This file ports FindProductDrawer's behaviour rather
 * than rewriting it:
 *   - browseSeqRef / searchSeqRef: two independent monotonic sequence
 *     guards, so an out-of-order async response never overwrites a newer
 *     one. Ascending to the root (currentId becomes null) invalidates any
 *     in-flight browse fetch without starting a new one — there is nothing
 *     to fetch at the root (it would be the whole catalog).
 *   - the 300ms search debounce (unchanged: this component has no minimum
 *     query length).
 *   - PAGE_SIZE = 25 and "load more" appending a page's rows onto `rows`
 *     rather than replacing them.
 *
 * `stack`, `query` and the category `tree` are controlled props, not local
 * state (the phase fix wave's F1/F2 fix) — UserDashboard owns them, the same
 * lifted-state shape it already uses for `ordersSegment`/`ordersSearch` on
 * OrdersView. This screen unmounts on every tab switch (rendered
 * conditionally on `activeTab === 'catalog'`, exactly like OrdersView on
 * `'orders'`), so anything kept as local state here resets on every switch
 * away and back. That used to mean: losing the consultant's drill-down
 * position and clearing their search on every trip back to this tab (picking
 * a product IS a tab switch — handleSearch's success path always shows the
 * product sheet on the scan tab), and re-fetching the category tree — an
 * uncached, unpaginated aggregate query (`core/views/catalog_read.py`) — on
 * every visit instead of once per session. `tree`/`treeLoading`/`treeError`/
 * `onRetryTree` mirror that: UserDashboard fetches the tree once and keeps
 * it across mounts, handing this screen a loading flag and an already
 * -translated error message with a retry callback instead of a fetch effect
 * of its own — so a failed fetch shows a message and a retry button instead
 * of a permanently blank tile wall, and a slow one shows a spinner instead of
 * an empty grid. `rows`, `results`, `count`, `page` and the loading flags
 * below stay local: losing them on a tab switch only costs a refetch (for
 * whichever `stack`/`query` position survived), not the consultant's
 * position.
 *
 * `resetToken` stands in for the deleted Drawer's open/close lifecycle: this
 * screen has no `open` prop to hang an `afterOpenChange` off of. Because
 * `stack`/`query` now survive a plain tab switch, a switch INTO this tab
 * must NOT reset them — only refocus the field — so the effect below skips
 * its very first run (the mount that follows every switch-in, first time or
 * not) and only resets on a later change: the parent bumping `resetToken`
 * again while this screen is already mounted, which happens only on a
 * re-tap of the already-active Catalog tab. Because React runs every effect
 * once on mount regardless of its dependency list, that skip has to be an
 * explicit ref, not just [resetToken] — a naive effect would silently wipe
 * the just-restored `stack`/`query` on every tab entry and undo the whole
 * fix while looking identical at a glance. Nothing here refocuses on a plain
 * re-render (a fetch resolving, a keystroke) — only a resetToken change past
 * the first does — so typing is never interrupted mid-word.
 */
const CatalogView = ({
    onSelectProduct,
    onScan,
    allWarehouses,
    onAllWarehousesChange,
    resetToken,
    stack,
    onStackChange,
    query,
    onQueryChange,
    tree,
    treeLoading,
    treeError,
    onRetryTree,
}) => {
    const {t} = useLanguage();
    const inputRef = useRef(null);

    const [results, setResults] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);

    const [rows, setRows] = useState([]);
    const [count, setCount] = useState(0);
    const [page, setPage] = useState(1);
    const [browseLoading, setBrowseLoading] = useState(false);

    // Monotonic tokens guarding against out-of-order async responses: a
    // response only lands if no newer request superseded it.
    const browseSeqRef = useRef(0);
    const searchSeqRef = useRef(0);

    // Debounced smart search — same 300ms pattern as the deleted
    // FindProductDrawer.js.
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

    // (Re)load the branch's products whenever the drill-down position moves
    // — including the first render after a tab switch restores a non-root
    // `stack` (see the docblock above): that is exactly when this needs to
    // refetch, since `rows` itself is not lifted.
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
    // — but only on a re-tap of the already-active tab, not on the mount
    // that follows a plain switch into it (see the docblock above).
    //
    // This tracks the last resetToken VALUE rather than "have I run once".
    // A run-once flag looks equivalent and is not: index.js renders the app
    // inside React.StrictMode, which in development mounts, tears down and
    // remounts every effect, so the flag is consumed by the first invocation
    // and the second one falls straight through to the reset — wiping the
    // lifted stack/query on every entry into the tab, i.e. silently undoing
    // the fix this effect exists to deliver. Comparing the token is
    // idempotent: a repeated run with an unchanged token does nothing, and
    // only a genuine bump resets.
    const lastResetTokenRef = useRef(resetToken);
    useEffect(() => {
        if (lastResetTokenRef.current === resetToken) {
            inputRef.current?.focus();
            return;
        }
        lastResetTokenRef.current = resetToken;
        onStackChange([]);
        onQueryChange('');
        inputRef.current?.focus();
    }, [resetToken, onStackChange, onQueryChange]);

    const children = useMemo(() => childrenForStack(tree, stack), [tree, stack]);
    const crumb = useMemo(() => breadcrumbForStack(tree, stack), [tree, stack]);
    const parentNode = useMemo(() => nodeForStack(tree, parentStack(stack)), [tree, stack]);
    const currentNode = useMemo(() => nodeForStack(tree, stack), [tree, stack]);

    const searching = query.trim().length > 0;

    const handleSelect = (sku) => {
        onQueryChange('');
        setResults([]);
        onSelectProduct(sku);
    };

    // `disabled` guards the search branch only (R1 fix) — while a refetch is
    // in flight, the previous query's rows are still on screen (see the
    // `searching` render below) and must not be selectable, or a fast typist
    // can add the wrong product before the new results land. The browse
    // branch never passes it: changing category clears `rows` synchronously,
    // so there is nothing stale there to guard against.
    const renderProductRow = (item, meta, {disabled = false} = {}) => (
        <button
            type="button"
            key={item.sku}
            className="if-row cv-product-row"
            onClick={() => {
                if (disabled) return;
                handleSelect(item.sku);
            }}
            disabled={disabled}
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

            <div className="if-toolbar">
            <div className="if-search" aria-busy={searchLoading || undefined}>
                <IosIcon name="search" size={18} stroke={2.4}/>
                <Input
                    ref={inputRef}
                    className="if-search-input"
                    variant="borderless"
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    placeholder={t.findProductPlaceholder}
                    aria-label={t.findProductPlaceholder}
                />
                {query ? (
                    // F3: while there's something to clear, the scan glyph —
                    // the less useful shortcut mid-query — is replaced by a
                    // clear button. Same pattern as OrdersView.js's search.
                    <button
                        type="button"
                        className="if-search-trail"
                        aria-label={t.clearSearch}
                        onClick={() => onQueryChange('')}
                    >
                        <IosIcon name="close" size={18} stroke={2.6}/>
                    </button>
                ) : (
                    <button
                        type="button"
                        className="if-search-trail is-action"
                        aria-label={t.scan}
                        onClick={onScan}
                    >
                        <IosIcon name="scan" size={20} stroke={2.2}/>
                    </button>
                )}
            </div>
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
                        // R1: dim + block pointer events on the group while a
                        // refetch is in flight — the same protection antd's
                        // <Spin spinning> gave the old drawer for free.
                        // aria-busy sits on this results container (not just
                        // the search bar above) so assistive tech announces
                        // the stale-but-visible state correctly.
                        <div
                            className={`if-group is-thumb-inset${searchLoading ? ' cv-stale' : ''}`}
                            aria-busy={searchLoading || undefined}
                        >
                            {results.map((item) => renderProductRow(item,
                                [item.article, (item.category_path || []).join(' › ')]
                                    .filter(Boolean).join(' · '),
                                {disabled: searchLoading}))}
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
                            {treeError ? (
                                // F2: a failed tree fetch used to leave a
                                // permanently blank tile wall with no
                                // message and no recovery short of another
                                // tab switch — now a translated error plus a
                                // retry that re-runs the same fetch in place.
                                <div className="if-group if-group-empty cv-tree-error">
                                    <p className="if-row-subtitle">{treeError}</p>
                                    <button type="button" className="if-btn if-btn-gray" onClick={onRetryTree}>
                                        {t.refreshData}
                                    </button>
                                </div>
                            ) : treeLoading ? (
                                // F2: a loading state instead of the tiles
                                // popping into an empty grid.
                                <div className="if-group if-group-empty" aria-busy="true">
                                    <span className="if-spinner"/>
                                </div>
                            ) : (
                                <div className="cv-tiles">
                                    {children.map((node) => {
                                        const palette = TILE_PALETTE[paletteIndex(node.id)];
                                        return (
                                            <button
                                                type="button"
                                                key={node.id}
                                                className="cv-tile"
                                                style={{background: palette.bg}}
                                                onClick={() => onStackChange([...stack, node.id])}
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
                            )}
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
                                    onClick={() => onStackChange(parentStack(stack))}
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
                                            onClick={() => onStackChange([...stack, node.id])}
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

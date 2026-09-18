import React, {useEffect, useRef, useState} from 'react';
import {Input, Popconfirm, Segmented} from 'antd';
import {orderService} from '../../api/services';
import {useLanguage} from '../../i18n/LanguageContext';
import IosIcon from '../Common/IosIcon';
import {
    ORDER_SEGMENTS,
    segmentLabelKey,
    segmentQuery,
    orderRow,
    groupByDay,
    emptyCopyKey,
} from './ordersListView';
import './OrdersView.css';

// Same 300ms debounce the old customer-search effect used
// (UserDashboard.js:234-253) — only typing a query still waits this long. A
// segment change fetches immediately (see the effect below): it is a
// discrete, deliberate tap, not something that needs settling like keystrokes
// do.
const FETCH_DEBOUNCE_MS = 300;

// relativeTime's {key, value} pair -> displayed text. Keys per
// ordersListView.js's current contract: justNow, minAgo, hoursAgo, clock
// (that day's own "HH:MM", already a finished string, so no t lookup) and
// none (no timestamp — nothing to show).
const timeLabel = (time, t) => {
    switch (time.key) {
        case 'justNow':
            return t.justNow;
        case 'minAgo':
            return t.minAgo(time.value);
        case 'hoursAgo':
            return t.hoursAgo(time.value);
        case 'clock':
            return time.value;
        case 'none':
        default:
            return '';
    }
};

/**
 * One order row: monogram (or a cart glyph for a retail order), name + id/
 * count meta, a trailing total-over-time column, a printer action (any
 * status) and — drafts only — a delete action behind a confirm. Only a draft
 * row is tappable (resumes it); the printer/trash controls stop propagation
 * so tapping them never also opens the row.
 */
const OrderRow = ({row, t, onOpenOrder, onPrint, onDelete}) => {
    const clickable = row.isResumable;
    const openRow = () => onOpenOrder(row.key);
    const handleKeyDown = (event) => {
        // The printer/trash buttons stop *pointer* propagation on click, but
        // a keyboard Enter/Space on either still bubbles here as a keydown
        // (bubbling can't be stopped per-event-type). Left unchecked, this
        // branch fires for them too, preventDefault-ing their own
        // Enter/Space-triggers-click default action and opening the row
        // instead of printing/deleting. Only react when the row itself is
        // the target.
        if (event.target !== event.currentTarget) {
            event.stopPropagation();
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openRow();
        }
    };

    return (
        <div
            className="if-row"
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            // The nested print/delete buttons carry their own aria-labels,
            // which the default accessible-name algorithm would otherwise
            // fold into this row's name ("Continue ... Print invoice #1048
            // Delete #1048"). An explicit label overrides that.
            aria-label={clickable ? `${t.continueOrder} ${row.name} #${row.key}` : undefined}
            onClick={clickable ? openRow : undefined}
            onKeyDown={clickable ? handleKeyDown : undefined}
            style={clickable ? undefined : {cursor: 'default'}}
        >
            <span className="if-avatar" aria-hidden="true">
                {row.isRetail ? <IosIcon name="cart" size={20} stroke={2}/> : row.initials}
            </span>
            <span className="if-row-main">
                <span className="if-row-title m-order-row-name">{row.name}</span>
                <span className="if-row-subtitle m-order-row-meta">{row.meta}</span>
            </span>
            <span className="if-row-trailing">
                {row.total !== undefined && (
                    <span className="if-row-title">{row.total} ₾</span>
                )}
                <span className="if-row-subtitle">{timeLabel(row.time, t)}</span>
            </span>
            <button
                type="button"
                className="if-stepper-btn"
                aria-label={`${t.printInvoice} #${row.key}`}
                onClick={(event) => {
                    event.stopPropagation();
                    onPrint(row.key);
                }}
            >
                <IosIcon name="print" size={18} stroke={2}/>
            </button>
            {row.isResumable && (
                <Popconfirm
                    title={t.confirmDelete}
                    onConfirm={(event) => {
                        event?.stopPropagation();
                        onDelete(row.key);
                    }}
                    onCancel={(event) => event?.stopPropagation()}
                    okText={t.yes}
                    cancelText={t.no}
                >
                    <button
                        type="button"
                        className="if-stepper-btn m-order-row-delete"
                        aria-label={`${t.delete} #${row.key}`}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <IosIcon name="trash" size={18}/>
                    </button>
                </Popconfirm>
            )}
            {clickable && (
                <span className="if-chev">
                    <IosIcon name="chev" size={16} stroke={2.4}/>
                </span>
            )}
        </div>
    );
};

/**
 * The consultant Orders tab (iOS redesign phase 5a): three status segments
 * (ღია/დადასტურებული/დასრულებული) over date-grouped rows, replacing the old
 * antd List of incomplete-drafts + a separate org-wide customer search
 * (UserDashboard.js's fetchIncompleteOrders / renderOrderRow / renderOrdersTab).
 *
 * `segment` and `query` are controlled props, not local state (F3 fix):
 * UserDashboard owns both so a tab switch — which unmounts this component,
 * since it only renders while activeTab === 'orders' — doesn't reset the
 * consultant's chosen segment or half-typed search. onSegmentChange /
 * onQueryChange are the setters UserDashboard passes down.
 *
 * One fetch effect, keyed on [segment, query], covers both the old "my
 * drafts" fetch and the old debounced customer search: an empty query uses
 * segmentQuery (created_by for drafts, org-wide for the other two); a
 * non-empty query searches within the current segment's status, org-wide
 * (colleagues' drafts stay findable, same as the old search). Both paths
 * unwrap `result.data?.results ?? result.data ?? []` — the old
 * fetchIncompleteOrders assumed a bare array while only the search path
 * defended against a future paginated response; enabling pagination would
 * otherwise throw inside its swallowed catch. A monotonic sequence ref
 * discards a response that resolves after a newer request has started (the
 * same pattern as FindProductDrawer's browseSeqRef / ClientLookupSheet's
 * searchSeqRef) — without it, a fast segment switch or a burst of keystrokes
 * could let a stale response land last.
 *
 * A segment change and a query change are NOT debounced the same way. A
 * segment tap is a discrete, deliberate action — mirroring the old
 * fetchIncompleteOrders, it fetches immediately (no setTimeout at all).
 * Typing still waits the 300ms FETCH_DEBOUNCE_MS. A segment change also
 * clears `orders` immediately (before the fetch resolves): without that, the
 * previous segment's rows would keep rendering — with their own totals and
 * timestamps — under the now-selected segment's already-highlighted pill for
 * the round trip, which reads as "nothing happened" rather than as loading.
 * While the list is empty and a fetch is in flight, an `.if-spinner`
 * replaces the empty-state text so a genuinely empty segment and a
 * loading-but-empty one never look the same. A failed fetch (F2 fix) is a
 * third, distinct state — `loadError` holds the already-translated message
 * `api/request.js` built, with a retry action that reuses the fetch — so it
 * can never be confused with a genuinely empty segment.
 */
const OrdersView = ({
    userId,
    activeOrderId,
    segment,
    onSegmentChange,
    query,
    onQueryChange,
    onOpenOrder,
    onPrint,
    onDelete,
    onNewOrder,
}) => {
    const {t} = useLanguage();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState('');
    const fetchSeqRef = useRef(0);
    // Sentinel (not a real segment value) so the very first run also counts
    // as "the segment changed" — the initial load should fetch immediately
    // too, same as the old fetchIncompleteOrders on tab activation. Reset to
    // the sentinel whenever the `!userId` guard below bails, so a later
    // fetch (once userId comes back) is treated as fresh rather than as a
    // same-segment debounce.
    const prevSegmentRef = useRef(null);

    // Shared by the effect below and the failure state's retry action, so
    // there is exactly one place that builds params and unwraps the
    // response. Takes the segment/query to fetch explicitly rather than
    // reading the props, so a retry always refetches for what's on screen
    // right now.
    const fetchOrders = async (targetSegment, targetQuery) => {
        const trimmed = targetQuery.trim();
        const params = trimmed
            ? {status: targetSegment, customer_search: trimmed}
            : segmentQuery(targetSegment, {userId});
        const seq = ++fetchSeqRef.current;
        setLoading(true);
        try {
            const result = await orderService.getOrders(params);
            if (seq !== fetchSeqRef.current) return;
            if (result.success) {
                setOrders(result.data?.results ?? result.data ?? []);
                setLoadError('');
            } else {
                // Distinct from a genuine empty segment (F2 fix) — result.error
                // is already a human-readable, translated message (falls back
                // to t.networkError itself when the request never reached the
                // server; see api/request.js::extractErrorMessage).
                setOrders([]);
                setLoadError(result.error);
            }
        } finally {
            if (seq === fetchSeqRef.current) setLoading(false);
        }
    };

    useEffect(() => {
        if (!userId) {
            setOrders([]);
            setLoading(false);
            setLoadError('');
            prevSegmentRef.current = null;
            return undefined;
        }
        const segmentChanged = segment !== prevSegmentRef.current;
        prevSegmentRef.current = segment;
        if (segmentChanged) {
            // Never let one segment's rows render under another's pill.
            setOrders([]);
            setLoadError('');
            fetchOrders(segment, query);
            return undefined;
        }
        const handle = setTimeout(() => fetchOrders(segment, query), FETCH_DEBOUNCE_MS);
        return () => clearTimeout(handle);
        // fetchOrders is intentionally omitted: it's recreated every render
        // from the same [segment, query, userId] this effect already
        // depends on, so including it would not change when the effect
        // fires — it would only make the dependency list noisier.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [segment, query, userId]);

    const handleRetry = () => fetchOrders(segment, query);

    const isSearching = query.trim().length > 0;
    // The ღია (draft) segment is the consultant's own drafts, minus whichever
    // one is already open on the active-order bar — resuming that one belongs
    // to the bar, not to a second tap here.
    const visibleOrders = segment === 'draft'
        ? orders.filter((o) => o.id !== activeOrderId)
        : orders;
    const now = new Date();
    const groups = groupByDay(visibleOrders, now);

    return (
        <div className="m-tab-content">
            <div className="if-navbar is-end">
                <button
                    type="button"
                    className="if-glass-btn is-prominent"
                    aria-label={t.newOrder}
                    onClick={onNewOrder}
                >
                    <IosIcon name="plus" size={22} stroke={2.4}/>
                </button>
            </div>
            <div className="if-large-header">
                <h1 className="if-large-title">{t.orders}</h1>
            </div>
            <div className="if-search">
                <IosIcon name="search" size={18} stroke={2.4}/>
                <Input
                    className="if-search-input"
                    variant="borderless"
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    placeholder={t.searchByCustomer}
                    aria-label={t.searchByCustomer}
                />
                {query && (
                    <button
                        type="button"
                        className="if-search-trail"
                        aria-label={t.clearSearch}
                        onClick={() => onQueryChange('')}
                    >
                        <IosIcon name="close" size={18} stroke={2.6}/>
                    </button>
                )}
            </div>
            <Segmented
                className="if-seg"
                block
                value={segment}
                onChange={onSegmentChange}
                options={ORDER_SEGMENTS.map((seg) => ({label: t[segmentLabelKey(seg)], value: seg}))}
            />
            {groups.length > 0 ? (
                groups.map((group) => (
                    <React.Fragment key={group.key}>
                        <h4 className="if-section-header">
                            {group.headingKey === 'date' ? group.headingValue : t[group.headingKey]}
                        </h4>
                        <div className="if-group is-avatar-inset">
                            {group.orders.map((order) => (
                                <OrderRow
                                    key={order.id}
                                    row={orderRow(order, t, now)}
                                    t={t}
                                    onOpenOrder={onOpenOrder}
                                    onPrint={onPrint}
                                    onDelete={onDelete}
                                />
                            ))}
                        </div>
                    </React.Fragment>
                ))
            ) : loading ? (
                // Loading-but-empty must never look like a genuine empty
                // state — this is the gap after a segment change (rows just
                // cleared) or a fresh search, both mid-flight.
                <div className="if-group if-group-empty" aria-busy="true">
                    <span className="if-spinner"/>
                </div>
            ) : loadError ? (
                // A failed fetch (F2 fix) — also never a genuine empty state,
                // and never silently identical to it.
                <div className="if-group if-group-empty m-orders-load-error">
                    <p className="if-row-subtitle">{loadError}</p>
                    <button type="button" className="if-btn if-btn-gray" onClick={handleRetry}>
                        {t.refreshData}
                    </button>
                </div>
            ) : (
                <div className="if-group if-group-empty">{t[emptyCopyKey(segment, isSearching)]}</div>
            )}
        </div>
    );
};

export default OrdersView;

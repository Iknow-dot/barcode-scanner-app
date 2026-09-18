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
            onClick={clickable ? openRow : undefined}
            onKeyDown={clickable ? handleKeyDown : undefined}
            style={clickable ? undefined : {cursor: 'default'}}
        >
            <span className="if-avatar" aria-hidden="true">
                {row.isRetail ? <IosIcon name="cart" size={20} stroke={2}/> : row.initials}
            </span>
            <span className="if-row-main">
                <span className="if-row-title m-order-row-name">{row.name}</span>
                <span className="if-row-subtitle">{row.meta}</span>
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
 * loading-but-empty one never look the same.
 */
const OrdersView = ({userId, activeOrderId, onOpenOrder, onPrint, onDelete, onNewOrder}) => {
    const {t} = useLanguage();
    const [segment, setSegment] = useState(ORDER_SEGMENTS[0]);
    const [query, setQuery] = useState('');
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(false);
    const fetchSeqRef = useRef(0);
    // Sentinel (not a real segment value) so the very first run also counts
    // as "the segment changed" — the initial load should fetch immediately
    // too, same as the old fetchIncompleteOrders on tab activation.
    const prevSegmentRef = useRef(null);

    useEffect(() => {
        if (!userId) {
            setOrders([]);
            return undefined;
        }
        const segmentChanged = segment !== prevSegmentRef.current;
        prevSegmentRef.current = segment;
        if (segmentChanged) {
            // Never let one segment's rows render under another's pill.
            setOrders([]);
        }
        setLoading(true);
        const trimmed = query.trim();
        const params = trimmed
            ? {status: segment, customer_search: trimmed}
            : segmentQuery(segment, {userId});

        const runFetch = async () => {
            const seq = ++fetchSeqRef.current;
            try {
                const result = await orderService.getOrders(params);
                if (seq !== fetchSeqRef.current) return;
                setOrders(result.success ? (result.data?.results ?? result.data ?? []) : []);
            } finally {
                if (seq === fetchSeqRef.current) setLoading(false);
            }
        };

        if (segmentChanged) {
            runFetch();
            return undefined;
        }
        const handle = setTimeout(runFetch, FETCH_DEBOUNCE_MS);
        return () => clearTimeout(handle);
    }, [segment, query, userId]);

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
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t.searchByCustomer}
                    aria-label={t.searchByCustomer}
                />
                {query && (
                    <button
                        type="button"
                        className="if-search-trail"
                        aria-label={t.clearSearch}
                        onClick={() => setQuery('')}
                    >
                        <IosIcon name="close" size={18} stroke={2.6}/>
                    </button>
                )}
            </div>
            <Segmented
                className="if-seg"
                block
                value={segment}
                onChange={setSegment}
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
            ) : (
                <div className="if-group if-group-empty">{t[emptyCopyKey(segment, isSearching)]}</div>
            )}
        </div>
    );
};

export default OrdersView;

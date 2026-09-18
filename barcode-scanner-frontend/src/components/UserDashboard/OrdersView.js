import React, {useEffect, useRef, useState} from 'react';
import {Input, Segmented} from 'antd';
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
    localDayBounds,
} from './ordersListView';
import {nextSwipeAxis, swipeRevealOffset, swipeRestsOpen} from './orderRowSwipe';
import './OrdersView.css';

// Matches .if-stepper-btn's 44px touch target (ios.css) — a draft row
// reveals print+delete (2 buttons), any other row reveals print alone.
const ACTION_BUTTON_WIDTH = 44;

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
 * count meta, a trailing total-over-time column and a chevron (drafts only).
 * The printer action (any status) and — drafts only — a delete action sit in
 * an `.if-swipe-actions` panel *behind* the row, revealed by swiping the row
 * left (iOS Mail/Messages idiom), by hovering it, or by focusing into the
 * panel with a keyboard (`:focus-within` in ios.css) — so the actions stay
 * reachable without a gesture. The swipe reveal already IS the deliberate
 * gesture, so a tap on delete once the row IS open deletes instantly — no
 * popover gate behind it. But hover and keyboard focus reveal the very same
 * actions with no swipe behind them at all (:hover / :focus-within in
 * ios.css) — a pointer merely crossing the row toward something else, or a
 * Tab landing on it, would otherwise let one click/Space delete an order
 * with zero deliberate gesture (F2 fix). So delete's own activation checks
 * `isOpen`: a tap or Space on delete while the row is still closed only
 * opens it (arms it, exactly like a swipe would), never deletes on that
 * first hit; the row being open — however it got that way — is what makes
 * the very next tap on delete instant. Print is unaffected (harmless,
 * reversible either way). `isOpen` is owned by OrdersView (only one row's actions are ever open at a time);
 * this component only decides the *live* drag offset while a touch is in
 * progress, via the pure functions in orderRowSwipe.js (nextSwipeAxis /
 * swipeRevealOffset / swipeRestsOpen) rather than doing that arithmetic
 * inline. Only a draft row is tappable on its own (resumes it); the actions
 * are DOM siblings of the row rather than nested inside it, so — unlike the
 * old inline buttons — their clicks/keydowns never bubble into the row's own
 * handlers at all. Delete's own onClick still calls stopPropagation
 * explicitly, belt-and-braces on top of that DOM structure, so tapping it
 * can never also open the order.
 */
const OrderRow = ({row, t, isOpen, onOpen, onClose, onOpenOrder, onPrint, onDelete}) => {
    const clickable = row.isResumable;
    const revealWidth = clickable ? ACTION_BUTTON_WIDTH * 2 : ACTION_BUTTON_WIDTH;
    const openRow = () => onOpenOrder(row.key);

    // Per-touch gesture state. Refs, not state: touchmove can fire many
    // times a frame and none of this needs its own render — only dragOffset
    // (below) does, since it drives the live inline transform.
    const touchRef = useRef({startX: 0, startY: 0, axis: 'undecided'});
    // Timestamp of the last horizontal drag's end, rather than a plain
    // just-dragged boolean: most browsers still deliver one trailing click
    // right after a touch sequence that dragged, and that specific click
    // must be swallowed (see handleContentClick) — but the SAME boolean
    // would just as happily swallow a later, unrelated tap on a row that's
    // been sitting open for a while, since nothing else ever clears it. A
    // short time window tells "the trailing click of this gesture" apart
    // from "a fresh tap", the same disambiguation FastClick-style libraries
    // use.
    const lastDragEndRef = useRef(0);
    const CLICK_SWALLOW_MS = 500;
    // null while not actively dragging (rest position comes from the
    // `is-open` class in ios.css instead) — a live px offset while a
    // horizontal drag is in progress, tracking the finger with no
    // transition.
    const [dragOffset, setDragOffset] = useState(null);

    const handleTouchStart = (event) => {
        touchRef.current = {
            startX: event.touches[0].clientX,
            startY: event.touches[0].clientY,
            axis: 'undecided',
        };
    };

    const handleTouchMove = (event) => {
        const touch = touchRef.current;
        const deltaX = event.touches[0].clientX - touch.startX;
        const deltaY = event.touches[0].clientY - touch.startY;
        touch.axis = nextSwipeAxis(touch.axis, deltaX, deltaY);
        // Vertical (or still-undecided) — leave it alone so the page's own
        // scroll handles it; touch-action: pan-y (ios.css) keeps the browser
        // from also treating this as a horizontal pan gesture of its own.
        if (touch.axis !== 'horizontal') return;
        setDragOffset(swipeRevealOffset(deltaX, revealWidth, isOpen));
    };

    const handleTouchEnd = () => {
        const touch = touchRef.current;
        if (touch.axis === 'horizontal' && dragOffset !== null) {
            lastDragEndRef.current = Date.now();
            if (swipeRestsOpen(dragOffset, revealWidth)) onOpen(); else onClose();
        }
        setDragOffset(null);
        touch.axis = 'undecided';
    };

    // Shared by a tap on the row and a keyboard Enter/Space on it: while the
    // actions are revealed, the first activation just closes them (the
    // standard iOS behaviour) instead of also resuming the order in the same
    // tap.
    const activateRow = () => {
        if (isOpen) {
            onClose();
            return;
        }
        if (clickable) openRow();
    };

    const handleContentClick = () => {
        // A drag that just ended still delivers a trailing click in most
        // browsers; swallow exactly that one so a swipe never also resumes
        // (or immediately re-closes) the row it just opened.
        if (Date.now() - lastDragEndRef.current < CLICK_SWALLOW_MS) return;
        activateRow();
    };

    const handleKeyDown = (event) => {
        // Nothing focusable lives inside .if-swipe-content any more (the
        // print/delete buttons are siblings in .if-swipe-actions, not
        // descendants), so a keydown reaching this handler always
        // originated on the row itself — kept as a guard rather than relied
        // on, in case something focusable is added here later.
        if (event.target !== event.currentTarget) {
            event.stopPropagation();
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activateRow();
        }
    };

    return (
        <div
            className={`if-swipe-row${isOpen ? ' is-open' : ''}`}
            data-order-row-key={row.key}
            style={{'--swipe-reveal': `${revealWidth}px`}}
        >
            <div className="if-swipe-actions">
                <button
                    type="button"
                    className="if-stepper-btn"
                    aria-label={`${t.printInvoice} #${row.key}`}
                    onClick={() => onPrint(row.key)}
                >
                    <IosIcon name="print" size={18} stroke={2}/>
                </button>
                {row.isResumable && (
                    <button
                        type="button"
                        className="if-stepper-btn m-order-row-delete"
                        aria-label={`${t.delete} #${row.key}`}
                        onClick={(event) => {
                            event.stopPropagation();
                            // F2: hover/focus can reveal this button with no
                            // swipe behind it — the first activation while
                            // the row is still closed only opens it (arms
                            // it), the same deliberate step a swipe already
                            // is. Only a tap while the row IS open deletes,
                            // still on a single instant tap, no dialog.
                            if (!isOpen) {
                                onOpen();
                                return;
                            }
                            onDelete(row.key);
                        }}
                    >
                        <IosIcon name="trash" size={18}/>
                    </button>
                )}
            </div>
            <div
                className="if-row if-swipe-content"
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                // An explicit label, same as before restructuring — nothing
                // inside .if-swipe-content carries its own label any more,
                // but this stays explicit rather than left to the default
                // accessible-name algorithm.
                aria-label={clickable ? `${t.continueOrder} ${row.name} #${row.key}` : undefined}
                onClick={handleContentClick}
                onKeyDown={handleKeyDown}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                style={{
                    cursor: clickable || isOpen ? 'pointer' : 'default',
                    ...(dragOffset !== null
                        ? {transform: `translateX(${dragOffset}px)`, transitionDuration: '0s'}
                        : {}),
                }}
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
                {clickable && (
                    <span className="if-chev">
                        <IosIcon name="chev" size={16} stroke={2.4}/>
                    </span>
                )}
            </div>
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
 * segmentQuery (created_by for drafts, org-wide for the other two) plus
 * `created_after`/`created_before` from `localDayBounds(new Date())` — all
 * three segments default to *today only* (the viewer's local day); a
 * non-empty query drops the day bounds entirely and searches within the
 * current segment's status, org-wide, across full history (colleagues'
 * drafts stay findable, same as the old search — and an older invoice is
 * still reprintable by name/phone/ID even though it has scrolled out of the
 * default list). Both paths unwrap `result.data?.results ?? result.data ?? []`
 * — the old
 * fetchIncompleteOrders assumed a bare array while only the search path
 * defended against a future paginated response; enabling pagination would
 * otherwise throw inside its swallowed catch. A monotonic sequence ref
 * discards a response that resolves after a newer request has started (the
 * same pattern as CatalogView's browseSeqRef / ClientLookupSheet's
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
    // At most one row's swipe actions are open at a time — setting this to a
    // new key implicitly closes whichever row had it before.
    const [openRowKey, setOpenRowKey] = useState(null);
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
        // All three segments default to *today only* (viewer's local day) —
        // a client search is exempt and reaches the full history, so a
        // consultant can still find and reprint an older invoice. Bounds are
        // computed fresh per fetch (not hoisted to render scope) so a fetch
        // that fires after midnight picks up the new day.
        let params;
        if (trimmed) {
            params = {status: targetSegment, customer_search: trimmed};
        } else {
            const {start, end} = localDayBounds(new Date());
            params = {
                ...segmentQuery(targetSegment, {userId}),
                created_after: start,
                created_before: end,
            };
        }
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

    // Tapping outside the open row, or scrolling the page (the page itself
    // scrolls — see index.css's .m-dashboard-body comment — there is no
    // inner scroll container here to listen on instead), closes it. The
    // delete button's own click carries stopPropagation, so a delete tap
    // never reaches this listener as an "outside" click in the first place —
    // no portaled-popup carve-out is needed any more now that delete is
    // instant instead of routed through a Popconfirm.
    useEffect(() => {
        if (openRowKey === null) return undefined;
        const closeIfOutside = (event) => {
            const hitRowKey = event.target.closest('.if-swipe-row')?.dataset.orderRowKey;
            if (hitRowKey !== String(openRowKey)) setOpenRowKey(null);
        };
        const closeOnScroll = () => setOpenRowKey(null);
        document.addEventListener('click', closeIfOutside);
        window.addEventListener('scroll', closeOnScroll, {passive: true});
        return () => {
            document.removeEventListener('click', closeIfOutside);
            window.removeEventListener('scroll', closeOnScroll);
        };
    }, [openRowKey]);

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
            <div className="if-toolbar">
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
            </div>
            {groups.length > 0 ? (
                groups.map((group) => (
                    <React.Fragment key={group.key}>
                        {/* The default (non-search) list is a single day, so a
                            header here would always read "today" and is just
                            noise. Search results can span days, so the
                            grouping — still built by groupByDay either way —
                            only earns a visible heading while searching. */}
                        {isSearching && (
                            <h4 className="if-section-header">
                                {group.headingKey === 'date' ? group.headingValue : t[group.headingKey]}
                            </h4>
                        )}
                        <div className="if-group is-avatar-inset">
                            {group.orders.map((order) => (
                                <OrderRow
                                    key={order.id}
                                    row={orderRow(order, t, now)}
                                    t={t}
                                    isOpen={openRowKey === order.id}
                                    onOpen={() => setOpenRowKey(order.id)}
                                    onClose={() => setOpenRowKey((current) => (current === order.id ? null : current))}
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

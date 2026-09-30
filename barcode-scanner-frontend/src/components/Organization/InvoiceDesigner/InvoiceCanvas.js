import React, {useEffect, useRef, useState} from 'react';
import {Empty} from 'antd';
import {orderService} from '../../../api';
import {useLanguage} from '../../../i18n/LanguageContext';
import {markSelected, wireDesignerFrame} from './designerFrame';
import {canvasScale, CANVAS_PAGE_WIDTH} from './canvasScale';

const RENDER_DELAY_MS = 400;

/**
 * A failed preview's `result.data` is the raw response body. The preview
 * request uses `responseType: 'text'`, so axios never JSON-parses it even
 * for a JSON error body — it arrives here as a plain string, which
 * `result.error` (built for a parsed body) just echoes back unflattened.
 * Parse defensively and pull out something readable: the layout error's
 * `detail`, or a flattened field-validation message (e.g. a half-typed
 * `invoice_email`); fall back to whatever `result.error` already has.
 */
const previewFailureDetail = (result) => {
    let parsed = null;
    if (typeof result.data === 'string') {
        try { parsed = JSON.parse(result.data); } catch { /* not JSON (e.g. a gateway's HTML page) */ }
    } else if (result.data && typeof result.data === 'object') {
        parsed = result.data;
    }
    if (parsed && typeof parsed === 'object') {
        if (typeof parsed.detail === 'string') return parsed.detail;
        const fieldMessages = Object.entries(parsed)
            .filter(([key, value]) => !(key === 'code' && typeof value === 'string'))
            .map(([field, value]) => {
                if (Array.isArray(value)) return `${field}: ${value.join(', ')}`;
                if (value && typeof value === 'object' && typeof value.detail === 'string') return `${field}: ${value.detail}`;
                return `${field}: ${value}`;
            })
            .join('; ');
        if (fieldMessages) return fieldMessages;
    }
    return result.error || '';
};

/**
 * Renders the live invoice preview in a blob iframe, wired so clicking a
 * block selects it in the designer.
 *
 * Double-buffered across two *fixed* iframe slots (A and B) that are never
 * remounted (no `key` swap). A new render's blob URL loads into whichever
 * slot is currently hidden; once that slot finishes loading and is wired,
 * visibility flips to it and the other slot's old blob URL is revoked. This
 * avoids both a blank flash (the visible slot never reloads mid-render) and
 * losing click wiring (a remount would drop the load-time wiring on the
 * frame the user is looking at).
 */
const InvoiceCanvas = ({orderId, layout, branding, legacyHtml, selectedBlockId, onSelectBlock, ordersFailed}) => {
    const {t} = useLanguage();
    const [urls, setUrls] = useState([null, null]); // [slotA url, slotB url]
    const [visibleSlot, setVisibleSlot] = useState(0);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const [failedDetail, setFailedDetail] = useState('');
    const frameRefs = [useRef(null), useRef(null)];
    const containerRef = useRef(null);
    // null until the first ResizeObserver callback; the frames render at the
    // CSS default (100% x 100%, unscaled) until then.
    const [containerSize, setContainerSize] = useState(null);
    const onSelectRef = useRef(onSelectBlock);
    const selectedRef = useRef(selectedBlockId);
    const urlsRef = useRef(urls);
    const visibleSlotRef = useRef(visibleSlot);
    onSelectRef.current = onSelectBlock;
    selectedRef.current = selectedBlockId;
    urlsRef.current = urls;
    visibleSlotRef.current = visibleSlot;

    useEffect(() => {
        if (!orderId) return undefined;
        let cancelled = false;
        const handle = setTimeout(async () => {
            setLoading(true);
            const result = legacyHtml !== null
                ? await orderService.fetchInvoicePreviewHtml(orderId, legacyHtml)
                : await orderService.fetchInvoiceLayoutPreviewHtml(orderId, {layout, branding});
            if (cancelled) return;
            setLoading(false);
            if (!result.success) {
                setFailed(true);
                setFailedDetail(previewFailureDetail(result));
                return;
            }
            setFailed(false);
            setFailedDetail('');
            const url = URL.createObjectURL(new Blob([result.data], {type: 'text/html'}));
            const hiddenSlot = visibleSlotRef.current === 0 ? 1 : 0;
            setUrls(prev => {
                // The hidden slot can never hold the visible slot's URL, so
                // any URL it holds here is an abandoned pending render
                // (never promoted, never revoked elsewhere) — revoke it
                // before overwriting so it doesn't leak.
                const abandoned = prev[hiddenSlot];
                if (abandoned) URL.revokeObjectURL(abandoned);
                const next = [...prev];
                next[hiddenSlot] = url;
                return next;
            });
        }, RENDER_DELAY_MS);
        return () => {
            cancelled = true;
            clearTimeout(handle);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orderId, layout, branding, legacyHtml]);

    useEffect(() => {
        const win = frameRefs[visibleSlot].current?.contentWindow;
        if (win?.document) markSelected(win.document, selectedBlockId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedBlockId, visibleSlot]);

    // The canvas shows the print layout, not a responsive one: both iframe
    // slots render at a fixed CANVAS_PAGE_WIDTH and are scaled down with a
    // CSS transform to fit whatever width the canvas actually has, so the
    // invoice's own `@media (max-width: 640px)` rules never fire just
    // because the designer's pane happens to be narrow.
    useEffect(() => {
        const node = containerRef.current;
        if (!node || typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            const {width, height} = entry.contentRect;
            setContainerSize({width, height});
        });
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    const scale = containerSize ? canvasScale(containerSize.width) : 1;
    const frameStyle = containerSize ? {
        width: CANVAS_PAGE_WIDTH,
        height: scale > 0 ? containerSize.height / scale : containerSize.height,
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
    } : undefined;

    const handleLoad = (slot, url) => (event) => {
        // Ignore a stale load: only promote if this slot still holds the URL
        // it was given (a newer render may have already replaced it before
        // the browser finished loading this one).
        if (urlsRef.current[slot] !== url) return;
        const win = event.currentTarget.contentWindow;
        wireDesignerFrame(win, id => onSelectRef.current(id));
        markSelected(win.document, selectedRef.current);
        const previousSlot = visibleSlotRef.current;
        const previousUrl = urlsRef.current[previousSlot];
        setVisibleSlot(slot);
        if (previousSlot !== slot && previousUrl) {
            URL.revokeObjectURL(previousUrl);
            setUrls(prev => {
                const next = [...prev];
                next[previousSlot] = null;
                return next;
            });
        }
    };

    useEffect(() => () => {
        urlsRef.current.forEach(url => { if (url) URL.revokeObjectURL(url); });
    }, []);

    // Dropping the order (orderId -> null) drops both iframes below; without
    // this, their blobs would sit un-revoked until unmount, and repeated
    // null/non-null cycles (switching orders) would leak one pair each time.
    useEffect(() => {
        if (orderId) return undefined;
        urlsRef.current.forEach(url => { if (url) URL.revokeObjectURL(url); });
        setUrls([null, null]);
        setVisibleSlot(0);
    }, [orderId]);

    if (!orderId) {
        const description = ordersFailed ? t.previewOrdersLoadFailed : t.noOrdersForPreview;
        return <div className="invoice-canvas"><Empty description={description} /></div>;
    }

    return (
        <div className="invoice-canvas" ref={containerRef}>
            {loading && <div className="invoice-canvas-progress" role="progressbar" aria-label={t.loading} />}
            {failed && (
                <div className="if-notice is-warning invoice-canvas-notice">
                    <div>{t.previewRefreshFailed}</div>
                    {failedDetail && <div className="invoice-canvas-notice-detail">{failedDetail}</div>}
                </div>
            )}
            {[0, 1].map(slot => {
                const url = urls[slot];
                const isVisible = slot === visibleSlot;
                return (
                    <iframe
                        key={slot}
                        ref={frameRefs[slot]}
                        title={isVisible ? t.invoiceDesigner : ''}
                        aria-hidden={isVisible ? undefined : 'true'}
                        src={url || 'about:blank'}
                        className={`invoice-canvas-frame${isVisible ? '' : ' is-pending'}`}
                        style={frameStyle}
                        onLoad={url ? handleLoad(slot, url) : undefined}
                    />
                );
            })}
        </div>
    );
};

export default InvoiceCanvas;

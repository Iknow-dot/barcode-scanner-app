import React, {useEffect, useRef, useState} from 'react';
import {Empty} from 'antd';
import {orderService} from '../../../api';
import {useLanguage} from '../../../i18n/LanguageContext';
import {markSelected, wireDesignerFrame} from './designerFrame';

const RENDER_DELAY_MS = 400;

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
const InvoiceCanvas = ({orderId, layout, branding, legacyHtml, selectedBlockId, onSelectBlock}) => {
    const {t} = useLanguage();
    const [urls, setUrls] = useState([null, null]); // [slotA url, slotB url]
    const [visibleSlot, setVisibleSlot] = useState(0);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const frameRefs = [useRef(null), useRef(null)];
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
                return;
            }
            setFailed(false);
            const url = URL.createObjectURL(new Blob([result.data], {type: 'text/html'}));
            const hiddenSlot = visibleSlotRef.current === 0 ? 1 : 0;
            setUrls(prev => {
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

    if (!orderId) {
        return <div className="invoice-canvas"><Empty description={t.noOrdersForPreview} /></div>;
    }

    return (
        <div className="invoice-canvas">
            {loading && <div className="invoice-canvas-progress" role="progressbar" aria-label={t.loading} />}
            {failed && <div className="if-notice is-warning invoice-canvas-notice">{t.previewRefreshFailed}</div>}
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
                        onLoad={url ? handleLoad(slot, url) : undefined}
                    />
                );
            })}
        </div>
    );
};

export default InvoiceCanvas;

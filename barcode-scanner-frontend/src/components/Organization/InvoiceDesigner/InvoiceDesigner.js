import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Button, ColorPicker, Input, Modal, Segmented, Select, Spin, Tooltip} from 'antd';
import {ReloadOutlined, SaveOutlined} from '@ant-design/icons';
import {invoiceTokenService, orderService, organizationService} from '../../../api';
import useAppNotification from '../../../hooks/useAppNotification';
import {useLanguage} from '../../../i18n/LanguageContext';
import displayCustomerName from '../../../utils/orderDisplay';
import BlockList from './BlockList';
import BlockInspector from './inspectors';
import BrandingFields from './inspectors/BrandingFields';
import InvoiceCanvas from './InvoiceCanvas';
import {addTextBlock, BRANDING_KEYS, changedBranding, isDirty, updateBlock, updatePage} from './invoiceLayout';
import './InvoiceDesigner.css';

// Page accent presets; the invoice page is a printed document, not app chrome,
// so these are the document's own colours rather than --if-* tokens.
const ACCENT_PRESETS = ['#3A9866', '#007AFF', '#5856D6', '#FF9500', '#FF3B30', '#1D1D1F'];

const pickBranding = source => Object.fromEntries(BRANDING_KEYS.map(key => [key, source?.[key] || '']));

const InvoiceDesigner = () => {
    const {t} = useLanguage();
    const {notify, contextHolder} = useAppNotification();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [tokens, setTokens] = useState({org: [], order: []});
    const [defaultLayout, setDefaultLayout] = useState(null);
    const [layout, setLayout] = useState(null);
    const [branding, setBranding] = useState({});
    const [legacyHtml, setLegacyHtml] = useState(null);
    const [saved, setSaved] = useState(null);
    const [selectedId, setSelectedId] = useState(null);
    const [orders, setOrders] = useState([]);
    const [orderId, setOrderId] = useState(null);
    const [ordersFailed, setOrdersFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const [catalog, settings, orderList] = await Promise.all([
                invoiceTokenService.fetchCatalogAndDefault(),
                organizationService.getInvoiceTemplate(),
                orderService.getOrders({page_size: 30}),
            ]);
            if (cancelled) return;
            if (!catalog.success || !settings.success) {
                notify.error(t.error, t.invoiceTemplateFetchError);
                setLoading(false);
                return;
            }
            const data = settings.data || {};
            const hasLayout = data.invoice_layout && Object.keys(data.invoice_layout).length > 0;
            const legacy = !hasLayout && (data.invoice_template_html || '').trim() ? data.invoice_template_html : null;
            const startLayout = hasLayout ? data.invoice_layout : catalog.data.default_layout;
            const startBranding = pickBranding(data);
            setTokens(catalog.data.tokens);
            setDefaultLayout(catalog.data.default_layout);
            setLayout(startLayout);
            setBranding(startBranding);
            setLegacyHtml(legacy);
            setSaved({layout: startLayout, branding: startBranding, legacy});
            const list = orderList?.success
                ? (Array.isArray(orderList.data) ? orderList.data : orderList.data?.results || [])
                : [];
            setOrders(list);
            setOrdersFailed(!orderList?.success);
            setOrderId(list[0]?.id ?? null);
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const dirty = useMemo(() => saved !== null && (
        (legacyHtml === null) !== (saved.legacy === null) || isDirty({layout, branding}, saved)
    ), [saved, layout, branding, legacyHtml]);

    useEffect(() => {
        if (!dirty) return undefined;
        const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);

    // Only re-upload the branding keys that actually changed (a logo can be
    // ~1.4 MB, and the debounced preview would otherwise resend it on every
    // unrelated layout edit); the backend falls back to the saved values for
    // any key left out. Memoised on `saved` too so the object identity is
    // stable across renders where nothing changed.
    const previewBranding = useMemo(
        () => (saved ? changedBranding(branding, saved.branding) : branding),
        [branding, saved],
    );

    const selectedBlock = layout?.blocks.find(b => b.id === selectedId) || null;
    const changeBlock = useCallback(patch => setLayout(current => updateBlock(current, selectedId, patch)), [selectedId]);
    const changeBranding = useCallback(patch => setBranding(current => ({...current, ...patch})), []);
    const changePage = patch => setLayout(current => updatePage(current, patch));

    const addText = () => {
        const result = addTextBlock(layout, selectedId);
        setLayout(result.layout);
        setSelectedId(result.id);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            // In legacy mode the org's template is still the old free-form
            // HTML; sending `invoice_layout` here would switch it over to the
            // designer as a side effect of a branding-only edit. So a legacy
            // save PATCHes just the branding keys.
            const payload = legacyHtml !== null ? {...branding} : {...branding, invoice_layout: layout};
            const result = await organizationService.updateInvoiceTemplate(payload);
            if (result.success) {
                if (legacyHtml !== null) {
                    setSaved(current => ({...current, branding}));
                } else {
                    setSaved({layout, branding, legacy: null});
                    setLegacyHtml(null);
                }
                notify.success(t.success, t.templateSaved);
                return;
            }
            const layoutError = result.data?.invoice_layout;
            if (layoutError?.code === 'INVOICE_LAYOUT_INVALID') {
                if (layoutError.block_id) setSelectedId(layoutError.block_id);
                notify.error(t.error, t.invoiceLayoutInvalid);
            } else {
                notify.error(t.error, result.error || t.invoiceTemplateUpdateError);
            }
        } finally {
            setSaving(false);
        }
    };

    const handleReset = () => Modal.confirm({
        title: t.resetToDefault,
        content: t.resetToDefaultConfirm,
        onOk: () => {
            setLayout(defaultLayout);
            setLegacyHtml(null);
            setSelectedId(null);
        },
    });

    if (loading) return <Spin />;
    if (!layout) return null;

    const orderOptions = orders.map(o => ({value: o.id, label: `#${o.id} — ${displayCustomerName(o, t)}`}));

    return (
        <div className="invoice-designer">
            {contextHolder}
            <div className="invoice-designer-bar">
                <strong>{t.invoiceDesigner}</strong>
                <Select size="small" style={{minWidth: 200}} value={orderId} onChange={setOrderId}
                        options={orderOptions} placeholder={t.sampleOrder} aria-label={t.sampleOrder}
                        showSearch optionFilterProp="label" disabled={!orders.length} />
                <span className="spacer" />
                {legacyHtml === null && (
                    <>
                        <Tooltip title={t.accentColor}>
                            <ColorPicker size="small" value={layout.page.accent} disabledAlpha
                                         presets={[{label: t.accentColor, colors: ACCENT_PRESETS}]}
                                         onChangeComplete={c => changePage({accent: c.toHexString().toUpperCase()})} />
                        </Tooltip>
                        <Segmented size="small" value={layout.page.variant}
                                   options={[{value: 'glass', label: t.variantGlass}, {value: 'classic', label: t.variantClassic}]}
                                   onChange={variant => changePage({variant})} />
                        <Input size="small" style={{width: 130}} maxLength={40} value={layout.page.title}
                               aria-label={t.invoiceTitleWord} placeholder={t.invoiceTitleWord}
                               onChange={e => changePage({title: e.target.value})} />
                    </>
                )}
                <Button size="small" icon={<ReloadOutlined />} onClick={handleReset}>{t.resetToDefault}</Button>
                <Button size="small" type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
                    {t.save}
                    {dirty && <span className="invoice-unsaved-dot" role="status" aria-label={t.unsavedChanges} />}
                </Button>
            </div>

            <div className="invoice-designer-body">
                {legacyHtml === null ? (
                    <div className="invoice-designer-pane">
                        <BlockList layout={layout} selectedId={selectedId} onSelect={setSelectedId}
                                   onChange={setLayout} onAddText={addText} />
                    </div>
                ) : (
                    <div className="invoice-designer-pane">
                        <div className="if-notice is-warning" style={{marginBottom: 12}}>{t.legacyTemplateBanner}</div>
                        <Button type="primary" block onClick={() => setLegacyHtml(null)} style={{marginBottom: 16}}>
                            {t.switchToDesigner}
                        </Button>
                        <BrandingFields branding={branding} onBrandingChange={changeBranding} />
                    </div>
                )}
                <InvoiceCanvas orderId={orderId} layout={layout} branding={previewBranding} legacyHtml={legacyHtml}
                               selectedBlockId={selectedId} onSelectBlock={setSelectedId} ordersFailed={ordersFailed} />
                {legacyHtml === null && (
                    <div className="invoice-designer-pane is-inspector">
                        <BlockInspector block={selectedBlock} branding={branding} tokens={tokens}
                                        onBlockChange={changeBlock} onBrandingChange={changeBranding} />
                    </div>
                )}
            </div>
        </div>
    );
};

export default InvoiceDesigner;

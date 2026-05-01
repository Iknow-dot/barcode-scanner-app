import React, {useEffect, useRef, useState} from 'react';
import {Select, Spin, Empty} from 'antd';
import * as orderService from '../../../api/services/orderService';
import {useLanguage} from '../../../i18n/LanguageContext';

// Debounced re-fetch when `templateHtml` changes; iframe receives a
// blob URL so we don't need to set custom headers on the <iframe src>.
const InvoicePreviewPanel = ({templateHtml}) => {
  const {t} = useLanguage();
  const [orders, setOrders] = useState([]);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const lastUrlRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function loadOrders() {
      const result = await orderService.getOrders({page_size: 30});
      if (cancelled) return;
      if (result?.success) {
        setOrders(Array.isArray(result.data) ? result.data : result.data?.results || []);
      }
    }
    loadOrders();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedOrderId) return;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await orderService.fetchInvoicePreviewHtml(selectedOrderId, templateHtml);
        if (!result.success) {
          setPreviewUrl(null);
          return;
        }
        const blob = new Blob([result.data], {type: 'text/html'});
        const url = URL.createObjectURL(blob);
        if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
        lastUrlRef.current = url;
        setPreviewUrl(url);
      } catch (e) {
        setPreviewUrl(null);
      } finally {
        setLoading(false);
      }
    }, 500);
    return () => clearTimeout(handle);
  }, [selectedOrderId, templateHtml]);

  useEffect(() => () => {
    if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
  }, []);

  return (
    <div style={{width: 400, borderLeft: '1px solid #eee', padding: 8, height: '100%', display: 'flex', flexDirection: 'column'}}>
      <Select
        style={{width: '100%', marginBottom: 8}}
        placeholder={t.selectOrderForPreview}
        value={selectedOrderId}
        onChange={setSelectedOrderId}
        options={orders.map((o) => ({value: o.id, label: `#${o.id} — ${o.customer_name || ''}`}))}
        showSearch
        optionFilterProp="label"
      />
      <div style={{flex: 1, position: 'relative', background: '#f5f5f5'}}>
        {loading && <Spin style={{position: 'absolute', top: '50%', left: '50%'}} />}
        {previewUrl ? (
          <iframe title="invoice-preview" src={previewUrl} style={{width: '100%', height: '100%', border: 0}} />
        ) : (
          <Empty description={t.selectOrderForPreview} style={{paddingTop: 60}} />
        )}
      </div>
    </div>
  );
};

export default InvoicePreviewPanel;

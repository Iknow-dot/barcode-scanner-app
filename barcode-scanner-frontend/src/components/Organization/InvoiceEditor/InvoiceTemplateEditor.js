import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {EditorContent, useEditor} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {Button, Dropdown, Flex, Select, Spin, Modal} from 'antd';
import InvoicePreviewPanel from './InvoicePreviewPanel';
import {
  BoldOutlined, ItalicOutlined, UnderlineOutlined,
  AlignLeftOutlined, AlignCenterOutlined, AlignRightOutlined,
  TableOutlined, FieldStringOutlined, RedoOutlined, UndoOutlined,
  SaveOutlined, ReloadOutlined,
} from '@ant-design/icons';

import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import {Table, TableRow, TableCell, TableHeader} from '@tiptap/extension-table';
import TokenNode from './TokenNode';
import invoiceTokenService from '../../../api/services/invoiceTokenService';
import * as orderService from '../../../api/services/orderService';
import {organizationService} from '../../../api';
import useAppNotification from '../../../hooks/useAppNotification';
import {useLanguage} from '../../../i18n/LanguageContext';
import './InvoiceTemplateEditor.css';

// Extend the stock Table to round-trip our `data-items-table` marker
// through the editor's parse/serialize cycle. Without this, the marker
// is silently stripped on paste/setContent and the renderer can no
// longer find the items table.
const ItemsTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      dataItemsTable: {
        default: null,
        parseHTML: (el) => (el.hasAttribute('data-items-table') ? '' : null),
        renderHTML: (attrs) =>
          attrs.dataItemsTable !== null ? {'data-items-table': ''} : {},
      },
    };
  },
});

// Same trick for `<tr data-repeat="items">` — the row that the renderer
// clones once per PurchaseOrderItem.
const ItemsTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      dataRepeat: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-repeat'),
        renderHTML: (attrs) =>
          attrs.dataRepeat ? {'data-repeat': attrs.dataRepeat} : {},
      },
    };
  },
});

// HTML the editor inserts when the admin clicks "Insert items table".
// Mirrors the items-table block in DEFAULT_INVOICE_TEMPLATE_HTML so a
// freshly inserted table is renderer-valid.
const ITEMS_TABLE_HTML = `
<table data-items-table class="items">
  <thead>
    <tr>
      <th>#</th><th>SKU</th><th>Name</th><th>Article</th><th>Warehouse</th>
      <th>Qty</th><th>Unit</th><th>Price</th><th>Discount</th><th>Line total</th>
    </tr>
  </thead>
  <tbody>
    <tr data-repeat="items">
      <td><span data-token="item.index"></span></td>
      <td><span data-token="item.sku"></span></td>
      <td><span data-token="item.sku_name"></span></td>
      <td><span data-token="item.article"></span></td>
      <td><span data-token="item.warehouse_name"></span></td>
      <td><span data-token="item.quantity"></span></td>
      <td><span data-token="item.unit"></span></td>
      <td><span data-token="item.price"></span> ₾</td>
      <td><span data-token="item.discount"></span></td>
      <td><span data-token="item.line_total"></span> ₾</td>
    </tr>
  </tbody>
</table>
`;

const InvoiceTemplateEditor = () => {
  const {t} = useLanguage();
  const {notify, contextHolder} = useAppNotification();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [defaultTemplate, setDefaultTemplate] = useState('');
  const [tokens, setTokens] = useState({org: [], order: [], item: []});
  const [sampleValues, setSampleValues] = useState({});
  const [sampleOrderId, setSampleOrderId] = useState(null); // null = auto (most recent)
  const [sampleOrderOptions, setSampleOrderOptions] = useState([]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TokenNode,
      Underline,
      TextAlign.configure({types: ['heading', 'paragraph']}),
      ItemsTable.configure({resizable: false}),
      ItemsTableRow,
      TableCell,
      TableHeader,
    ],
    content: '<p></p>',
  });

  const [editorHtml, setEditorHtml] = useState('');
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => setEditorHtml(editor.getHTML());
    editor.on('update', onUpdate);
    return () => editor.off('update', onUpdate);
  }, [editor]);

  // --- Live-fill: walk the doc and update every token node's label attr ---
  const applyLiveFill = useCallback((values) => {
    if (!editor || Object.keys(values).length === 0) return;
    editor.commands.command(({tr, state}) => {
      let changed = false;
      state.doc.descendants((node, pos) => {
        if (node.type.name !== 'token') return;
        const token = node.attrs.token;
        const resolved = values[token];
        const newLabel = resolved !== undefined && resolved !== '' ? resolved : (token || '');
        if (newLabel !== node.attrs.label) {
          tr.setNodeMarkup(pos, undefined, {...node.attrs, label: newLabel});
          changed = true;
        }
      });
      return changed;
    });
  }, [editor]);

  // Re-apply whenever sampleValues change (including after initial load
  // and after a setContent that resets all labels to their i18n defaults).
  useEffect(() => {
    applyLiveFill(sampleValues);
  }, [sampleValues, applyLiveFill]); // eslint-disable-line react-hooks/exhaustive-deps

  // When a new token node is inserted (via the menu) the doc triggers an
  // 'update' event. We hook into it to re-apply live fill on every update
  // so newly inserted chips immediately show their real value.
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => applyLiveFill(sampleValues);
    editor.on('update', onUpdate);
    return () => editor.off('update', onUpdate);
  }, [editor, sampleValues, applyLiveFill]);

  // --- Fetch sample values whenever sampleOrderId changes ---
  useEffect(() => {
    let cancelled = false;
    async function loadSampleValues() {
      const result = await invoiceTokenService.fetchSampleValues(
        sampleOrderId ? {orderId: sampleOrderId} : {}
      );
      if (cancelled) return;
      if (result.success) {
        setSampleValues(result.data);
      }
    }
    loadSampleValues();
    return () => { cancelled = true; };
  }, [sampleOrderId]);

  // --- Main load: tokens catalog + saved template + order list for picker ---
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [tokensResult, settingsResult, ordersResult] = await Promise.all([
          invoiceTokenService.fetchCatalogAndDefault(),
          organizationService.getInvoiceTemplate(),
          orderService.getOrders({page_size: 30}),
        ]);
        if (cancelled) return;
        if (!tokensResult.success || !settingsResult.success) {
          notify.error(t.error, t.previewLoadFailed);
          return;
        }
        setTokens(tokensResult.data.tokens);
        setDefaultTemplate(tokensResult.data.default_template_html);
        const saved = settingsResult.data?.invoice_template_html || '';
        editor?.commands.setContent(saved || tokensResult.data.default_template_html);

        // Populate order picker options
        if (ordersResult?.success) {
          const orderList = Array.isArray(ordersResult.data)
            ? ordersResult.data
            : ordersResult.data?.results || [];
          setSampleOrderOptions(orderList);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (editor) load();
    return () => { cancelled = true; };
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  const insertItemsTable = () => {
    editor?.chain().focus().insertContent(ITEMS_TABLE_HTML).run();
  };

  const tokenMenuItems = useMemo(() => {
    const groups = ['org', 'order', 'item'];
    return groups.map((scope) => ({
      key: scope,
      label: t[`tokenScope${scope[0].toUpperCase() + scope.slice(1)}`],
      children: (tokens[scope] || []).map((name) => ({
        key: `${scope}.${name}`,
        label: t[`tokenLabel_${scope}_${name}`] || `${scope}.${name}`,
        onClick: () => {
          const token = `${scope}.${name}`;
          const label = sampleValues[token] || t[`tokenLabel_${scope}_${name}`] || token;
          editor?.chain().focus().insertContent({
            type: 'token',
            attrs: {token, label, scope},
          }).run();
        },
      })),
    }));
  }, [tokens, t, editor, sampleValues]);

  const handleSave = async () => {
    if (!editor) return;
    setSaving(true);
    try {
      const html = editor.getHTML();
      const result = await organizationService.updateInvoiceTemplate({
        invoice_template_html: html,
      });
      if (result.success) {
        notify.success(t.success, t.templateSaved);
      } else {
        notify.error(t.error, result.error || t.templateInvalid);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    Modal.confirm({
      title: t.resetToDefault,
      content: t.templateUnsavedChanges,
      onOk: () => editor?.commands.setContent(defaultTemplate),
    });
  };

  if (loading || !editor) return <Spin />;

  const orderPickerOptions = [
    {value: null, label: t.sampleDataAuto || 'Auto (most recent)'},
    ...sampleOrderOptions.map((o) => ({
      value: o.id,
      label: `#${o.id} — ${o.customer_name || ''}`,
    })),
  ];

  return (
    <>
      {contextHolder}
      <div className="invoice-editor-toolbar">
        <Button size="small" icon={<UndoOutlined />} onClick={() => editor.chain().focus().undo().run()} />
        <Button size="small" icon={<RedoOutlined />} onClick={() => editor.chain().focus().redo().run()} />
        <Button size="small" icon={<BoldOutlined />} onClick={() => editor.chain().focus().toggleBold().run()} />
        <Button size="small" icon={<ItalicOutlined />} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <Button size="small" icon={<UnderlineOutlined />} onClick={() => editor.chain().focus().toggleUnderline().run()} />
        <Button size="small" icon={<AlignLeftOutlined />} onClick={() => editor.chain().focus().setTextAlign('left').run()} />
        <Button size="small" icon={<AlignCenterOutlined />} onClick={() => editor.chain().focus().setTextAlign('center').run()} />
        <Button size="small" icon={<AlignRightOutlined />} onClick={() => editor.chain().focus().setTextAlign('right').run()} />
        <Dropdown menu={{items: tokenMenuItems}} trigger={['click']}>
          <Button size="small" icon={<FieldStringOutlined />}>{t.insertToken}</Button>
        </Dropdown>
        <Button size="small" icon={<TableOutlined />} onClick={insertItemsTable}>{t.insertItemsTable}</Button>
        <div style={{flex: 1}} />
        <Select
          size="small"
          style={{minWidth: 160}}
          value={sampleOrderId}
          onChange={setSampleOrderId}
          options={orderPickerOptions}
          placeholder={t.sampleDataAuto || 'Sample data'}
          showSearch
          optionFilterProp="label"
        />
        <Button size="small" onClick={handleReset} icon={<ReloadOutlined />}>{t.resetToDefault}</Button>
        <Button size="small" type="primary" loading={saving} onClick={handleSave} icon={<SaveOutlined />}>{t.save}</Button>
      </div>
      <Flex style={{height: 'calc(100vh - 200px)'}}>
        <div className="invoice-editor-page-bg" style={{flex: 1, overflow: 'auto'}}>
          <div className="invoice-editor-surface">
            <EditorContent editor={editor} />
          </div>
        </div>
        <InvoicePreviewPanel templateHtml={editorHtml} />
      </Flex>
    </>
  );
};

export default InvoiceTemplateEditor;

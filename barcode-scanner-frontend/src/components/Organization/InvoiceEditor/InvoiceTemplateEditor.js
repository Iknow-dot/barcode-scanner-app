import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {EditorContent, useEditor} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {Button, ColorPicker, Dropdown, Flex, Select, Spin, Modal} from 'antd';
import InvoicePreviewPanel from './InvoicePreviewPanel';
import {
  BoldOutlined, ItalicOutlined, UnderlineOutlined,
  AlignLeftOutlined, AlignCenterOutlined, AlignRightOutlined,
  TableOutlined, FieldStringOutlined, RedoOutlined, UndoOutlined,
  SaveOutlined, ReloadOutlined,
  UnorderedListOutlined, OrderedListOutlined,
  FontColorsOutlined, BgColorsOutlined,
} from '@ant-design/icons';

import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import {Table, TableRow, TableCell, TableHeader} from '@tiptap/extension-table';
import {TextStyle, FontSize, Color} from '@tiptap/extension-text-style';
import {Highlight} from '@tiptap/extension-highlight';
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

const SEPARATOR = <div style={{width: 1, background: '#e0e0e0', alignSelf: 'stretch', margin: '0 2px'}} />;

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
      ItemsTable.configure({resizable: true}),
      ItemsTableRow,
      TableCell,
      TableHeader,
      TextStyle,
      FontSize.configure({types: ['textStyle']}),
      Color,
      Highlight.configure({multicolor: true}),
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

  const tableMenu = useMemo(() => ({
    items: [
      {key: 'add-row-above', label: 'Add row above', onClick: () => editor?.chain().focus().addRowBefore().run()},
      {key: 'add-row-below', label: 'Add row below', onClick: () => editor?.chain().focus().addRowAfter().run()},
      {key: 'delete-row', label: 'Delete row', onClick: () => editor?.chain().focus().deleteRow().run()},
      {type: 'divider'},
      {key: 'add-col-left', label: 'Add column left', onClick: () => editor?.chain().focus().addColumnBefore().run()},
      {key: 'add-col-right', label: 'Add column right', onClick: () => editor?.chain().focus().addColumnAfter().run()},
      {key: 'delete-col', label: 'Delete column', onClick: () => editor?.chain().focus().deleteColumn().run()},
      {type: 'divider'},
      {key: 'toggle-header-row', label: 'Toggle header row', onClick: () => editor?.chain().focus().toggleHeaderRow().run()},
    ],
  }), [editor]);

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

  const currentFontSize = editor.getAttributes('textStyle').fontSize?.replace('px', '') || undefined;
  const currentColor = editor.getAttributes('textStyle').color || '#000000';
  const currentHighlight = editor.getAttributes('highlight').color || '#ffffff';

  const headingValue =
    editor.isActive('heading', {level: 1}) ? 'h1' :
    editor.isActive('heading', {level: 2}) ? 'h2' :
    editor.isActive('heading', {level: 3}) ? 'h3' : 'p';

  return (
    <>
      {contextHolder}
      <div className="invoice-editor-toolbar">
        {/* Undo / Redo */}
        <Flex gap={4} align="center">
          <Button size="small" icon={<UndoOutlined />} onClick={() => editor.chain().focus().undo().run()} />
          <Button size="small" icon={<RedoOutlined />} onClick={() => editor.chain().focus().redo().run()} />
        </Flex>

        {SEPARATOR}

        {/* Basic text style: B / I / U */}
        <Flex gap={4} align="center">
          <Button
            size="small"
            icon={<BoldOutlined />}
            type={editor.isActive('bold') ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().toggleBold().run()}
          />
          <Button
            size="small"
            icon={<ItalicOutlined />}
            type={editor.isActive('italic') ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          />
          <Button
            size="small"
            icon={<UnderlineOutlined />}
            type={editor.isActive('underline') ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          />
        </Flex>

        {SEPARATOR}

        {/* Heading dropdown + font-size picker */}
        <Flex gap={4} align="center">
          <Select
            size="small"
            value={headingValue}
            style={{width: 110}}
            onChange={(v) => {
              if (v === 'p') editor.chain().focus().setParagraph().run();
              else editor.chain().focus().toggleHeading({level: Number(v.slice(1))}).run();
            }}
            options={[
              {value: 'p', label: 'Paragraph'},
              {value: 'h1', label: 'Heading 1'},
              {value: 'h2', label: 'Heading 2'},
              {value: 'h3', label: 'Heading 3'},
            ]}
          />
          <Select
            size="small"
            style={{width: 72}}
            placeholder="Size"
            value={currentFontSize}
            onChange={(px) => {
              if (!px) editor.chain().focus().unsetFontSize().run();
              else editor.chain().focus().setFontSize(`${px}px`).run();
            }}
            options={[8, 10, 12, 14, 16, 18, 24, 32].map((n) => ({value: String(n), label: `${n}px`}))}
            allowClear
          />
        </Flex>

        {SEPARATOR}

        {/* Color pickers: text color + highlight */}
        <Flex gap={4} align="center">
          <ColorPicker
            size="small"
            presets={[{label: 'Common', colors: ['#000000', '#1677ff', '#722ed1', '#52c41a', '#fa541c', '#fadb14', '#ffffff']}]}
            value={currentColor}
            onChangeComplete={(c) => editor.chain().focus().setColor(c.toHexString()).run()}
          >
            <Button size="small" icon={<FontColorsOutlined />} title="Text color" />
          </ColorPicker>
          <ColorPicker
            size="small"
            presets={[{label: 'Highlight', colors: ['#fff59d', '#a5d6a7', '#90caf9', '#ffab91', '#ce93d8', 'transparent']}]}
            value={currentHighlight}
            onChangeComplete={(c) => editor.chain().focus().toggleHighlight({color: c.toHexString()}).run()}
          >
            <Button size="small" icon={<BgColorsOutlined />} title="Highlight color" />
          </ColorPicker>
        </Flex>

        {SEPARATOR}

        {/* Alignment */}
        <Flex gap={4} align="center">
          <Button
            size="small"
            icon={<AlignLeftOutlined />}
            type={editor.isActive({textAlign: 'left'}) ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
          />
          <Button
            size="small"
            icon={<AlignCenterOutlined />}
            type={editor.isActive({textAlign: 'center'}) ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
          />
          <Button
            size="small"
            icon={<AlignRightOutlined />}
            type={editor.isActive({textAlign: 'right'}) ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().setTextAlign('right').run()}
          />
        </Flex>

        {SEPARATOR}

        {/* Bullet list + numbered list */}
        <Flex gap={4} align="center">
          <Button
            size="small"
            icon={<UnorderedListOutlined />}
            type={editor.isActive('bulletList') ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          />
          <Button
            size="small"
            icon={<OrderedListOutlined />}
            type={editor.isActive('orderedList') ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          />
        </Flex>

        {SEPARATOR}

        {/* Insert token + Insert items table */}
        <Flex gap={4} align="center">
          <Dropdown menu={{items: tokenMenuItems}} trigger={['click']}>
            <Button size="small" icon={<FieldStringOutlined />}>{t.insertToken}</Button>
          </Dropdown>
          <Button size="small" icon={<TableOutlined />} onClick={insertItemsTable}>{t.insertItemsTable}</Button>
        </Flex>

        {SEPARATOR}

        {/* Table operations (only usable when cursor is inside a table) */}
        <Dropdown menu={tableMenu} trigger={['click']} disabled={!editor.isActive('table')}>
          <Button size="small" icon={<TableOutlined />}>Table</Button>
        </Dropdown>

        <div style={{flex: 1}} />

        {/* Right side: sample-data picker + reset + save */}
        <Flex gap={4} align="center">
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
        </Flex>
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

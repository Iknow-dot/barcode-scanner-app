import React, {useEffect, useMemo, useState} from 'react';
import {EditorContent, useEditor} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {Button, Dropdown, Flex, Spin, Modal} from 'antd';
import InvoicePreviewPanel from './InvoicePreviewPanel';
import {
  BoldOutlined, ItalicOutlined, UnderlineOutlined,
  AlignLeftOutlined, AlignCenterOutlined, AlignRightOutlined,
  TableOutlined, FieldStringOutlined, RedoOutlined, UndoOutlined,
  SaveOutlined, ReloadOutlined,
} from '@ant-design/icons';

import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import TokenNode from './TokenNode';
import invoiceTokenService from '../../../api/services/invoiceTokenService';
import {organizationService} from '../../../api';
import useAppNotification from '../../../hooks/useAppNotification';
import {useLanguage} from '../../../i18n/LanguageContext';
import './InvoiceTemplateEditor.css';

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

  const editor = useEditor({
    extensions: [
      StarterKit,
      TokenNode,
      Underline,
      TextAlign.configure({types: ['heading', 'paragraph']}),
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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const tokensResult = await invoiceTokenService.fetchCatalogAndDefault();
        const settingsResult = await organizationService.getInvoiceTemplate();
        if (cancelled) return;
        if (!tokensResult.success || !settingsResult.success) {
          notify.error(t.error, t.previewLoadFailed);
          return;
        }
        setTokens(tokensResult.data.tokens);
        setDefaultTemplate(tokensResult.data.default_template_html);
        const saved = settingsResult.data?.invoice_template_html || '';
        editor?.commands.setContent(saved || tokensResult.data.default_template_html);
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
          const label = t[`tokenLabel_${scope}_${name}`] || token;
          editor?.chain().focus().insertContent({
            type: 'token',
            attrs: {token, label, scope},
          }).run();
        },
      })),
    }));
  }, [tokens, t, editor]);

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

import React, {useMemo} from 'react';
import {EditorContent, useEditor} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import {Button, Dropdown, Flex} from 'antd';
import {
    AlignCenterOutlined, AlignLeftOutlined, AlignRightOutlined, BoldOutlined, FieldStringOutlined,
    ItalicOutlined, OrderedListOutlined, UnderlineOutlined, UnorderedListOutlined,
} from '@ant-design/icons';
import {useLanguage} from '../../../../i18n/LanguageContext';
import TokenNode from '../TokenNode';

// Text blocks carry org/order fields only: item fields are valid only inside
// the items table, and the backend rejects them here.
const SCOPES = ['org', 'order'];

const TextInspector = ({block, tokens, onBlockChange}) => {
    const {t} = useLanguage();
    const editor = useEditor({
        extensions: [
            StarterKit.configure({heading: {levels: [2, 3]}, codeBlock: false, code: false, blockquote: false, horizontalRule: false}),
            Underline,
            TextAlign.configure({types: ['heading', 'paragraph']}),
            TokenNode,
        ],
        content: block.html || '<p></p>',
        onUpdate: ({editor: e}) => onBlockChange({html: e.getHTML()}),
    });

    const fieldMenu = useMemo(() => ({
        items: SCOPES.map(scope => ({
            key: scope,
            label: t[`tokenScope${scope[0].toUpperCase()}${scope.slice(1)}`],
            children: (tokens[scope] || []).filter(name => name !== 'logo').map(name => ({
                key: `${scope}.${name}`,
                label: t[`tokenLabel_${scope}_${name}`] || `${scope}.${name}`,
                onClick: () => editor?.chain().focus().insertContent({
                    type: 'token',
                    attrs: {token: `${scope}.${name}`, scope, label: t[`tokenLabel_${scope}_${name}`] || `${scope}.${name}`},
                }).run(),
            })),
        })),
    }), [tokens, t, editor]);

    if (!editor) return null;
    const mark = (name, icon, run, attrs) => (
        <Button size="small" icon={icon} aria-label={name}
                type={editor.isActive(attrs || name) ? 'primary' : 'default'} onClick={run} />
    );
    return (
        <>
            <Flex wrap gap={4} style={{marginBottom: 8}}>
                {mark('bold', <BoldOutlined />, () => editor.chain().focus().toggleBold().run())}
                {mark('italic', <ItalicOutlined />, () => editor.chain().focus().toggleItalic().run())}
                {mark('underline', <UnderlineOutlined />, () => editor.chain().focus().toggleUnderline().run())}
                {mark('bulletList', <UnorderedListOutlined />, () => editor.chain().focus().toggleBulletList().run())}
                {mark('orderedList', <OrderedListOutlined />, () => editor.chain().focus().toggleOrderedList().run())}
                {mark('left', <AlignLeftOutlined />, () => editor.chain().focus().setTextAlign('left').run(), {textAlign: 'left'})}
                {mark('center', <AlignCenterOutlined />, () => editor.chain().focus().setTextAlign('center').run(), {textAlign: 'center'})}
                {mark('right', <AlignRightOutlined />, () => editor.chain().focus().setTextAlign('right').run(), {textAlign: 'right'})}
                <Dropdown menu={fieldMenu} trigger={['click']}>
                    <Button size="small" icon={<FieldStringOutlined />}>{t.insertToken}</Button>
                </Dropdown>
            </Flex>
            <div className="invoice-text-editor"><EditorContent editor={editor} /></div>
        </>
    );
};

export default TextInspector;

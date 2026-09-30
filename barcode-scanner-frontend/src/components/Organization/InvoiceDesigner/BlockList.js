import React from 'react';
import {Button, Tooltip} from 'antd';
import {ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EyeInvisibleOutlined, EyeOutlined, PlusOutlined} from '@ant-design/icons';
import {useLanguage} from '../../../i18n/LanguageContext';
import {blockTitle, MAX_TEXT_BLOCKS, moveBlock, removeBlock, toggleBlockHidden} from './invoiceLayout';

const BlockList = ({layout, selectedId, onSelect, onChange, onAddText}) => {
    const {t} = useLanguage();
    const stop = fn => (event) => { event.stopPropagation(); fn(); };
    const textBlockCount = layout.blocks.filter(b => b.type === 'text').length;
    return (
        <div>
            <h5>{t.blocks}</h5>
            {layout.blocks.map((block, index) => (
                <div
                    key={block.id}
                    role="button"
                    tabIndex={0}
                    className={`invoice-block-row${block.id === selectedId ? ' is-selected' : ''}${block.hidden ? ' is-hidden' : ''}`}
                    onClick={() => onSelect(block.id)}
                    onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        onSelect(block.id);
                    }}
                >
                    <span className="title">{blockTitle(block, t)}</span>
                    <Tooltip title={t.moveUp}>
                        <Button size="small" type="text" aria-label={t.moveUp} icon={<ArrowUpOutlined />}
                                disabled={index === 0} onClick={stop(() => onChange(moveBlock(layout, block.id, -1)))} />
                    </Tooltip>
                    <Tooltip title={t.moveDown}>
                        <Button size="small" type="text" aria-label={t.moveDown} icon={<ArrowDownOutlined />}
                                disabled={index === layout.blocks.length - 1}
                                onClick={stop(() => onChange(moveBlock(layout, block.id, 1)))} />
                    </Tooltip>
                    <Tooltip title={block.hidden ? t.showBlock : t.hideBlock}>
                        <Button size="small" type="text" aria-label={block.hidden ? t.showBlock : t.hideBlock}
                                icon={block.hidden ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                                onClick={stop(() => onChange(toggleBlockHidden(layout, block.id)))} />
                    </Tooltip>
                    {block.type === 'text' && (
                        <Tooltip title={t.deleteBlock}>
                            <Button size="small" type="text" danger aria-label={t.deleteBlock} icon={<DeleteOutlined />}
                                    onClick={stop(() => onChange(removeBlock(layout, block.id)))} />
                        </Tooltip>
                    )}
                </div>
            ))}
            <Button block type="dashed" icon={<PlusOutlined />} onClick={onAddText} style={{marginTop: 6}}
                    disabled={textBlockCount >= MAX_TEXT_BLOCKS}>
                {t.addTextBlock}
            </Button>
        </div>
    );
};

export default BlockList;

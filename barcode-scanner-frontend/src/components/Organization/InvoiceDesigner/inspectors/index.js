import React from 'react';
import {Empty} from 'antd';
import {useLanguage} from '../../../../i18n/LanguageContext';
import {blockTitle} from '../invoiceLayout';
import HeaderInspector from './HeaderInspector';
import PartiesInspector from './PartiesInspector';
import ItemsInspector from './ItemsInspector';
import TotalsInspector from './TotalsInspector';
import TextInspector from './TextInspector';
import FooterInspector from './FooterInspector';

const BY_TYPE = {
    header: HeaderInspector,
    parties: PartiesInspector,
    items: ItemsInspector,
    totals: TotalsInspector,
    text: TextInspector,
    footer: FooterInspector,
};

const BlockInspector = ({block, branding, tokens, onBlockChange, onBrandingChange}) => {
    const {t} = useLanguage();
    if (!block) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t.selectBlockHint} />;
    const Inspector = BY_TYPE[block.type];
    return (
        <>
            <h5>{blockTitle(block, t)}</h5>
            {/* key: a text editor must never carry one block's content into another. */}
            <Inspector key={block.id} block={block} branding={branding} tokens={tokens}
                       onBlockChange={onBlockChange} onBrandingChange={onBrandingChange} />
        </>
    );
};

export default BlockInspector;

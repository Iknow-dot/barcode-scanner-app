import React from 'react';
import {useLanguage} from '../../../../i18n/LanguageContext';
import EntryListEditor from '../EntryListEditor';

const ItemsInspector = ({block, onBlockChange}) => {
    const {t} = useLanguage();
    return (
        <>
            <h5>{t.columnsLabel}</h5>
            <EntryListEditor entries={block.columns} textField="label" requireOneVisible
                             labelFor={key => t[`tokenLabel_item_${key}`] || key}
                             onChange={columns => onBlockChange({columns})} />
        </>
    );
};

export default ItemsInspector;

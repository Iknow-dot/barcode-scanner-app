import React from 'react';
import {useLanguage} from '../../../../i18n/LanguageContext';
import EntryListEditor from '../EntryListEditor';

const SECTION_KEYS = {order: 'sectionOrder', customer: 'sectionCustomer', delivery: 'sectionDelivery', recipient: 'sectionRecipient'};

const PartiesInspector = ({block, onBlockChange}) => {
    const {t} = useLanguage();
    return (
        <>
            <h5>{t.sectionsLabel}</h5>
            <EntryListEditor entries={block.sections} textField="heading" labelFor={key => t[SECTION_KEYS[key]] || key}
                             onChange={sections => onBlockChange({sections})} />
        </>
    );
};

export default PartiesInspector;

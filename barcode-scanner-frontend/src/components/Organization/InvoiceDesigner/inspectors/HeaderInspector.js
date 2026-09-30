import React from 'react';
import {Flex, Switch} from 'antd';
import {useLanguage} from '../../../../i18n/LanguageContext';
import BrandingFields from './BrandingFields';

const Toggle = ({label, checked, onChange}) => (
    <Flex justify="space-between" align="center" style={{marginBottom: 8}}>
        <span>{label}</span>
        <Switch size="small" checked={checked} aria-label={label} onChange={onChange} />
    </Flex>
);

const HEADER_FIELDS = ['invoice_logo', 'invoice_display_name', 'invoice_address', 'invoice_phone', 'invoice_email'];

const HeaderInspector = ({block, branding, onBlockChange, onBrandingChange}) => {
    const {t} = useLanguage();
    return (
        <>
            <BrandingFields branding={branding} onBrandingChange={onBrandingChange} fields={HEADER_FIELDS} />
            <Toggle label={t.showLogo} checked={block.show_logo} onChange={v => onBlockChange({show_logo: v})} />
            <Toggle label={t.showIdNumber} checked={block.show_identification_number}
                    onChange={v => onBlockChange({show_identification_number: v})} />
            <Toggle label={t.showContacts} checked={block.show_contacts} onChange={v => onBlockChange({show_contacts: v})} />
        </>
    );
};

export default HeaderInspector;

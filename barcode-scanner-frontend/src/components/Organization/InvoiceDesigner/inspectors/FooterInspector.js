import React from 'react';
import {Form, Input} from 'antd';
import {useLanguage} from '../../../../i18n/LanguageContext';

const FooterInspector = ({branding, onBrandingChange}) => {
    const {t} = useLanguage();
    return (
        <Form layout="vertical" size="small">
            <Form.Item label={t.invoiceFooterText}>
                <Input.TextArea rows={5} value={branding.invoice_footer_text || ''}
                                onChange={e => onBrandingChange({invoice_footer_text: e.target.value})} />
            </Form.Item>
        </Form>
    );
};

export default FooterInspector;

import React from 'react';
import {Button, Flex, Form, Input, message, Upload} from 'antd';
import {DeleteOutlined, UploadOutlined} from '@ant-design/icons';
import {useLanguage} from '../../../../i18n/LanguageContext';
import {BRANDING_KEYS} from '../invoiceLayout';

const LOGO_LIMIT = 1_048_576;

/**
 * One organization branding field, keyed by its `branding` object key.
 * `fields` (below) picks which of these a given caller renders, in order.
 */
const FIELD_ITEMS = {
    invoice_logo: ({t, branding, onBrandingChange}) => {
        const readLogo = (file) => {
            if (file.size > LOGO_LIMIT) {
                message.warning(t.logoTooLarge);
                return Upload.LIST_IGNORE;
            }
            const reader = new FileReader();
            reader.onload = e => onBrandingChange({invoice_logo: e.target.result});
            reader.onerror = () => message.error(t.logoReadError);
            reader.readAsDataURL(file);
            return Upload.LIST_IGNORE;
        };
        return (
            <Form.Item label={t.invoiceLogo} key="invoice_logo">
                <Flex gap={8} align="center">
                    {branding.invoice_logo && <img src={branding.invoice_logo} alt="" style={{maxWidth: 96, maxHeight: 48}} />}
                    <Upload beforeUpload={readLogo} showUploadList={false}
                            accept="image/png,image/jpeg,image/webp,image/svg+xml">
                        <Button icon={<UploadOutlined />}>{t.invoiceLogo}</Button>
                    </Upload>
                    {branding.invoice_logo && (
                        <Button type="text" danger aria-label={t.removeLogo} icon={<DeleteOutlined />}
                                onClick={() => onBrandingChange({invoice_logo: ''})} />
                    )}
                </Flex>
            </Form.Item>
        );
    },
    invoice_display_name: ({t, branding, onBrandingChange}) => (
        <Form.Item label={t.invoiceDisplayName} key="invoice_display_name">
            <Input maxLength={255} value={branding.invoice_display_name || ''}
                   onChange={e => onBrandingChange({invoice_display_name: e.target.value})} />
        </Form.Item>
    ),
    invoice_address: ({t, branding, onBrandingChange}) => (
        <Form.Item label={t.invoiceAddress} key="invoice_address">
            <Input.TextArea rows={2} value={branding.invoice_address || ''}
                            onChange={e => onBrandingChange({invoice_address: e.target.value})} />
        </Form.Item>
    ),
    invoice_phone: ({t, branding, onBrandingChange}) => (
        <Form.Item label={t.invoicePhone} key="invoice_phone">
            <Input maxLength={50} value={branding.invoice_phone || ''}
                   onChange={e => onBrandingChange({invoice_phone: e.target.value})} />
        </Form.Item>
    ),
    invoice_email: ({t, branding, onBrandingChange}) => (
        <Form.Item label={t.invoiceEmail} key="invoice_email">
            <Input maxLength={254} value={branding.invoice_email || ''}
                   onChange={e => onBrandingChange({invoice_email: e.target.value})} />
        </Form.Item>
    ),
    invoice_footer_text: ({t, branding, onBrandingChange}) => (
        <Form.Item label={t.invoiceFooterText} key="invoice_footer_text">
            <Input.TextArea rows={5} value={branding.invoice_footer_text || ''}
                            onChange={e => onBrandingChange({invoice_footer_text: e.target.value})} />
        </Form.Item>
    ),
};

/**
 * A subset of the organization's branding fields, picked by `fields` (an
 * ordered array of `BRANDING_KEYS`; defaults to all of them). Each inspector
 * shows only the fields it owns — `HeaderInspector` the header fields,
 * `FooterInspector` just the footer text — while the legacy-template pane
 * (InvoiceDesigner, which has no per-block inspectors to split them across)
 * renders every field by using the default.
 */
const BrandingFields = ({branding, onBrandingChange, fields = BRANDING_KEYS}) => {
    const {t} = useLanguage();
    return (
        <Form layout="vertical" size="small">
            {fields.map(key => FIELD_ITEMS[key]({t, branding, onBrandingChange}))}
        </Form>
    );
};

export default BrandingFields;

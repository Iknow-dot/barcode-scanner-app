import React from 'react';
import {Button, Flex, Form, Input, message, Upload} from 'antd';
import {DeleteOutlined, UploadOutlined} from '@ant-design/icons';
import {useLanguage} from '../../../../i18n/LanguageContext';

const LOGO_LIMIT = 1_048_576;

/**
 * The organization's branding fields (logo, display name, address, phone,
 * email, footer text) — everything `HeaderInspector` and `FooterInspector`
 * edit on the `branding` object, minus the header block's own show/hide
 * toggles. Shared by both inspectors and by the legacy-template banner
 * (InvoiceDesigner), which has no blocks to attach an inspector to but still
 * needs to let an org on the old free-form template edit its branding.
 */
const BrandingFields = ({branding, onBrandingChange}) => {
    const {t} = useLanguage();
    const field = key => ({
        value: branding[key] || '',
        onChange: e => onBrandingChange({[key]: e.target.value}),
    });
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
        <Form layout="vertical" size="small">
            <Form.Item label={t.invoiceLogo}>
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
            <Form.Item label={t.invoiceDisplayName}><Input maxLength={255} {...field('invoice_display_name')} /></Form.Item>
            <Form.Item label={t.invoiceAddress}><Input.TextArea rows={2} {...field('invoice_address')} /></Form.Item>
            <Form.Item label={t.invoicePhone}><Input maxLength={50} {...field('invoice_phone')} /></Form.Item>
            <Form.Item label={t.invoiceEmail}><Input maxLength={254} {...field('invoice_email')} /></Form.Item>
            <Form.Item label={t.invoiceFooterText}>
                <Input.TextArea rows={5} {...field('invoice_footer_text')} />
            </Form.Item>
        </Form>
    );
};

export default BrandingFields;

import React from 'react';
import {Button, Flex, Form, Input, message, Switch, Upload} from 'antd';
import {DeleteOutlined, UploadOutlined} from '@ant-design/icons';
import {useLanguage} from '../../../../i18n/LanguageContext';

const LOGO_LIMIT = 1_048_576;

const Toggle = ({label, checked, onChange}) => (
    <Flex justify="space-between" align="center" style={{marginBottom: 8}}>
        <span>{label}</span>
        <Switch size="small" checked={checked} aria-label={label} onChange={onChange} />
    </Flex>
);

const HeaderInspector = ({block, branding, onBlockChange, onBrandingChange}) => {
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
            <Form.Item label={t.invoiceDisplayName}><Input {...field('invoice_display_name')} /></Form.Item>
            <Form.Item label={t.invoiceAddress}><Input.TextArea rows={2} {...field('invoice_address')} /></Form.Item>
            <Form.Item label={t.invoicePhone}><Input {...field('invoice_phone')} /></Form.Item>
            <Form.Item label={t.invoiceEmail}><Input {...field('invoice_email')} /></Form.Item>
            <Toggle label={t.showLogo} checked={block.show_logo} onChange={v => onBlockChange({show_logo: v})} />
            <Toggle label={t.showIdNumber} checked={block.show_identification_number}
                    onChange={v => onBlockChange({show_identification_number: v})} />
            <Toggle label={t.showContacts} checked={block.show_contacts} onChange={v => onBlockChange({show_contacts: v})} />
        </Form>
    );
};

export default HeaderInspector;

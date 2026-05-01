import React, {useEffect, useState} from 'react';
import {
    Button,
    Card,
    Divider,
    Flex,
    Form,
    Image,
    Input,
    message,
    Spin,
    Upload,
} from 'antd';
import {
    DeleteOutlined,
    FileImageOutlined,
    SaveOutlined,
    UploadOutlined,
} from '@ant-design/icons';
import {organizationService} from '../../api';
import useAppNotification from '../../hooks/useAppNotification';
import {useLanguage} from '../../i18n/LanguageContext';

const InvoiceTemplateSettings = () => {
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const {notify, contextHolder} = useAppNotification();
    const {t} = useLanguage();
    const logoValue = Form.useWatch('invoice_logo', form);

    useEffect(() => {
        const fetchSettings = async () => {
            setLoading(true);
            try {
                const result = await organizationService.getInvoiceTemplate();
                if (result.success) {
                    form.setFieldsValue({
                        invoice_logo: result.data.invoice_logo || '',
                        invoice_display_name: result.data.invoice_display_name || '',
                        invoice_address: result.data.invoice_address || '',
                        invoice_phone: result.data.invoice_phone || '',
                        invoice_email: result.data.invoice_email || '',
                        invoice_footer_text: result.data.invoice_footer_text || '',
                    });
                } else {
                    notify.error(t.error, result.error || t.invoiceTemplateFetchError);
                }
            } finally {
                setLoading(false);
            }
        };
        fetchSettings();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Use AntD's static `message` API for the size warning — same rationale
    // as in EditOrganization.js (mounting a per-component contextHolder
    // inside a leaf form adds noise without UX benefit).
    const handleLogoFile = (file) => {
        if (file.size > 1_048_576) {
            message.warning(t.logoTooLarge);
            return Upload.LIST_IGNORE;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            form.setFieldsValue({invoice_logo: e.target.result});
        };
        reader.onerror = () => {
            message.error(t.logoReadError);
        };
        reader.readAsDataURL(file);
        return Upload.LIST_IGNORE;
    };

    const handleSubmit = async (values) => {
        setSaving(true);
        try {
            const result = await organizationService.updateInvoiceTemplate({
                invoice_logo: values.invoice_logo || '',
                invoice_display_name: values.invoice_display_name || '',
                invoice_address: values.invoice_address || '',
                invoice_phone: values.invoice_phone || '',
                invoice_email: values.invoice_email || '',
                invoice_footer_text: values.invoice_footer_text || '',
            });
            if (result.success) {
                notify.success(t.success, t.invoiceTemplateUpdated);
            } else {
                notify.error(t.error, result.error || t.invoiceTemplateUpdateError);
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            {contextHolder}
            <Spin spinning={loading}>
                <Card
                    style={{maxWidth: 600, margin: '0 auto'}}
                    styles={{body: {paddingTop: 24}}}
                >
                    <Form
                        form={form}
                        layout="vertical"
                        size="large"
                        onFinish={handleSubmit}
                    >
                        <Divider style={{margin: '0 0 16px'}}>
                            <Flex align="center" gap={6} style={{opacity: 0.7, fontSize: 13}}>
                                <FileImageOutlined/>
                                {t.invoiceTemplate}
                            </Flex>
                        </Divider>

                        <Form.Item label={t.invoiceLogo}>
                            <Flex align="center" gap={12}>
                                {logoValue ? (
                                    <Image src={logoValue} alt="logo" width={120}
                                           style={{maxHeight: 80, objectFit: 'contain', border: '1px solid #eee'}}/>
                                ) : (
                                    <div style={{
                                        width: 120, height: 60, border: '1px dashed #ccc',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: '#aaa',
                                    }}>
                                        —
                                    </div>
                                )}
                                <Flex vertical gap={4}>
                                    <Upload beforeUpload={handleLogoFile} showUploadList={false}
                                            accept="image/png,image/jpeg,image/webp,image/svg+xml">
                                        <Button icon={<UploadOutlined/>}>{t.invoiceLogo}</Button>
                                    </Upload>
                                    {logoValue && (
                                        <Button type="text" danger size="small" icon={<DeleteOutlined/>}
                                                onClick={() => form.setFieldsValue({invoice_logo: ''})}>
                                            {t.removeLogo}
                                        </Button>
                                    )}
                                </Flex>
                            </Flex>
                        </Form.Item>
                        <Form.Item name="invoice_logo" hidden>
                            <Input/>
                        </Form.Item>

                        <Form.Item label={t.invoiceDisplayName} name="invoice_display_name">
                            <Input/>
                        </Form.Item>
                        <Form.Item label={t.invoiceAddress} name="invoice_address">
                            <Input.TextArea rows={2}/>
                        </Form.Item>
                        <Flex gap={16}>
                            <Form.Item label={t.invoicePhone} name="invoice_phone" style={{flex: 1}}>
                                <Input/>
                            </Form.Item>
                            <Form.Item label={t.invoiceEmail} name="invoice_email" style={{flex: 1}}>
                                <Input/>
                            </Form.Item>
                        </Flex>
                        <Form.Item label={t.invoiceFooterText} name="invoice_footer_text">
                            <Input.TextArea rows={3}/>
                        </Form.Item>

                        <Form.Item style={{marginTop: 8, marginBottom: 0}}>
                            <Button
                                block
                                type="primary"
                                htmlType="submit"
                                loading={saving}
                                icon={<SaveOutlined/>}
                                style={{height: 44, fontWeight: 600}}
                            >
                                {t.save}
                            </Button>
                        </Form.Item>
                    </Form>
                </Card>
            </Spin>
        </>
    );
};

export default InvoiceTemplateSettings;

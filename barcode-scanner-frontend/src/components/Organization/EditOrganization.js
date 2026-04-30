import React from 'react';
import ModalForm, {useModalFormLoading} from "../ModalForm";
import {Button, Divider, Flex, Form, Input, InputNumber, Switch, Tag, Upload, Image, message} from "antd";
import {
    LockOutlined,
    UserOutlined,
    SaveOutlined,
    GlobalOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    UploadOutlined,
    FileImageOutlined,
    DeleteOutlined,
} from "@ant-design/icons";
import {useLanguage} from '../../i18n/LanguageContext';

const EditOrganizationForm = ({hasPassword}) => {
    const {t} = useLanguage();
    const {loading} = useModalFormLoading();
    const form = Form.useFormInstance();
    const logoValue = Form.useWatch('invoice_logo', form);

    const handleLogoFile = (file) => {
        if (file.size > 1_048_576) {
            message.warning(t.logoTooLarge);
            return Upload.LIST_IGNORE;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            form.setFieldsValue({invoice_logo: e.target.result});
        };
        reader.readAsDataURL(file);
        return Upload.LIST_IGNORE;
    };

    return (
        <>
            <Form.Item
                label={t.organizationName}
                name="name"
                rules={[{required: true, message: t.orgNameRequired}]}
            >
                <Input/>
            </Form.Item>

            <Flex gap={16}>
                <Form.Item
                    label={t.identificationNumber}
                    name="identification_number"
                    style={{flex: 1}}
                    rules={[{required: true, message: t.idNumberRequired}]}
                >
                    <Input/>
                </Form.Item>

                <Form.Item
                    label={t.employeesCount}
                    name="employees_count"
                    style={{flex: 1}}
                    rules={[{required: true, message: t.employeesCountRequired}]}
                >
                    <InputNumber style={{width: '100%'}} min={1}/>
                </Form.Item>
            </Flex>

            <Divider style={{margin: '8px 0 16px'}}>
                <Flex align="center" gap={6} style={{opacity: 0.7, fontSize: 13}}>
                    <GlobalOutlined/>
                    {t.webService}
                </Flex>
            </Divider>

            <Form.Item
                label={t.address}
                name="web_service_url"
                rules={[{required: true, message: t.webServiceUrlRequired}]}
            >
                <Input/>
            </Form.Item>
            <Form.Item
                label={t.name}
                name="web_service_username"
                rules={[{required: false, message: t.webServiceUsernameHint}]}
            >
                <Input prefix={<UserOutlined style={{opacity: 0.4}}/>}/>
            </Form.Item>

            <Flex gap={16} align="flex-start">
                <Form.Item
                    style={{flex: 1}}
                    label={
                        <Flex align="center" gap={8}>
                            {t.password}
                            {hasPassword ? (
                                <Tag icon={<CheckCircleOutlined/>} color="success"
                                     style={{fontSize: 11, marginLeft: 4}}>
                                    {t.passwordIsSet}
                                </Tag>
                            ) : (
                                <Tag icon={<CloseCircleOutlined/>} color="default"
                                     style={{fontSize: 11, marginLeft: 4}}>
                                    {t.passwordNotSet}
                                </Tag>
                            )}
                        </Flex>
                    }
                    name="web_service_password"
                    extra={<span style={{fontSize: 12, opacity: 0.5}}>{t.leaveEmptyPassword}</span>}
                >
                    <Input.Password prefix={<LockOutlined style={{opacity: 0.4}}/>} autoComplete="new-password"/>
                </Form.Item>
                <Form.Item label={t.clearPassword} name="clear_password">
                    <Switch/>
                </Form.Item>
            </Flex>

            <Divider style={{margin: '16px 0 16px'}}>
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
                        <div style={{width: 120, height: 60, border: '1px dashed #ccc',
                                     display: 'flex', alignItems: 'center', justifyContent: 'center',
                                     color: '#aaa'}}>
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
            {/* Hidden field that actually carries the data URL to the backend. */}
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

            <Form.Item label={null} style={{marginTop: 8, marginBottom: 0}}>
                <Button block type="primary" htmlType="submit" loading={loading}
                        icon={<SaveOutlined/>}
                        style={{height: 44, fontWeight: 600}}>
                    {t.save}
                </Button>
            </Form.Item>
        </>
    );
};

const EditOrganization = ({visible, setVisible, onFinish, object}) => {
    const {t} = useLanguage();

    return (
        <ModalForm
            object={object}
            title={t.editOrganization}
            visible={visible}
            setVisible={setVisible}
            onFinish={(data) => onFinish(data, object)}
        >
            <EditOrganizationForm hasPassword={object?.has_password}/>
        </ModalForm>
    );
};

export default EditOrganization;

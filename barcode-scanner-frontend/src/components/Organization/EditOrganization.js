import React from 'react';
import ModalForm, {useModalFormLoading} from "../ModalForm";
import {Button, Divider, Flex, Form, Input, InputNumber, Switch, Tag} from "antd";
import {
    LockOutlined,
    UserOutlined,
    SaveOutlined,
    GlobalOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    AppstoreOutlined,
} from "@ant-design/icons";
import {useLanguage} from '../../i18n/LanguageContext';

const EditOrganizationForm = ({hasPassword}) => {
    const {t} = useLanguage();
    const {loading} = useModalFormLoading();
    const form = Form.useFormInstance();
    const catalogEnabled = Form.useWatch('product_catalog_enabled', form);

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
                    <AppstoreOutlined/>
                    {t.featuresSection}
                </Flex>
            </Divider>

            {/* Per-organization feature toggles — future org-level feature
                switches are appended inside this section. */}
            <Form.Item
                label={t.giftMarkingEnabled}
                name="gift_marking_enabled"
                valuePropName="checked"
                extra={<span style={{fontSize: 12, opacity: 0.5}}>{t.giftMarkingHint}</span>}
            >
                <Switch/>
            </Form.Item>

            <Flex gap={16} align="flex-start">
                <Form.Item
                    label={t.productCatalogEnabled}
                    name="product_catalog_enabled"
                    valuePropName="checked"
                    style={{flex: 1}}
                    extra={<span style={{fontSize: 12, opacity: 0.5}}>{t.productCatalogHint}</span>}
                >
                    <Switch/>
                </Form.Item>
                <Form.Item
                    label={t.productLimit}
                    name="product_limit"
                    style={{flex: 1}}
                    extra={<span style={{fontSize: 12, opacity: 0.5}}>{t.productLimitHint}</span>}
                >
                    <InputNumber style={{width: '100%'}} min={1}
                                 disabled={!catalogEnabled}
                                 placeholder={t.productLimitUnlimited}/>
                </Form.Item>
            </Flex>

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

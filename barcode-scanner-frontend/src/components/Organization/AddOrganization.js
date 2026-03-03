import React from 'react';
import {Button, Divider, Flex, Form, Input, InputNumber} from "antd";
import ModalForm, {useModalFormLoading} from "../ModalForm";
import {LockOutlined, UserOutlined, PlusOutlined, GlobalOutlined} from "@ant-design/icons";
import {useLanguage} from '../../i18n/LanguageContext';

const AddOrganizationForm = () => {
    const {t} = useLanguage();
    const {loading} = useModalFormLoading();

    return (
        <>
            <Form.Item
                label={t.organizationName}
                name="name"
                rules={[
                    {
                        required: true,
                        message: t.orgNameRequired,
                    },
                ]}
            >
                <Input placeholder={t.organizationName}/>
            </Form.Item>

            <Flex gap={16}>
                <Form.Item
                    label={t.identificationNumber}
                    name="identification_number"
                    style={{flex: 1}}
                    rules={[
                        {
                            required: true,
                            message: t.idNumberRequired,
                        },
                    ]}
                >
                    <Input placeholder={t.identificationNumber}/>
                </Form.Item>

                <Form.Item
                    label={t.employeesCount}
                    name="employees_count"
                    style={{flex: 1}}
                    rules={[
                        {
                            required: true,
                            message: t.employeesCountRequired,
                        }
                    ]}
                >
                    <InputNumber style={{width: '100%'}} min={1} placeholder="0"/>
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
                rules={[
                    {
                        required: true,
                        message: t.webServiceUrlRequired,
                    }
                ]}
            >
                <Input placeholder="https://"/>
            </Form.Item>

            <Flex gap={16}>
                <Form.Item
                    label={t.user}
                    name="web_service_username"
                    style={{flex: 1}}
                    rules={[
                        {
                            required: false,
                            message: t.webServiceUsernameHint,
                        }
                    ]}
                >
                    <Input autoComplete="off" prefix={<UserOutlined style={{opacity: 0.4}}/>}/>
                </Form.Item>
                <Form.Item
                    label={t.password}
                    name="web_service_password"
                    style={{flex: 1}}
                    rules={[
                        {
                            required: false,
                            message: t.webServicePasswordHint,
                        }
                    ]}
                >
                    <Input.Password autoComplete="new-password" prefix={<LockOutlined style={{opacity: 0.4}}/>}/>
                </Form.Item>
            </Flex>

            <Form.Item label={null} style={{marginTop: 8, marginBottom: 0}}>
                <Button
                    block
                    type="primary"
                    htmlType="submit"
                    loading={loading}
                    icon={<PlusOutlined/>}
                    style={{height: 44, fontWeight: 600}}
                >
                    {t.add}
                </Button>
            </Form.Item>
        </>
    );
};

const AddOrganization = ({visible, setVisible, onFinish}) => {
    const {t} = useLanguage();

    return (
        <ModalForm
            visible={visible}
            setVisible={setVisible}
            onFinish={onFinish}
            title={t.addOrganization}
        >
            <AddOrganizationForm/>
        </ModalForm>
    );
};

export default AddOrganization;

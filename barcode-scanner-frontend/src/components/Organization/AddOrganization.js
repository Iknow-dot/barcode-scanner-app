import React from 'react';
import {Button, Divider, Flex, Form, Input, InputNumber} from "antd";
import ModalForm from "../ModalForm";
import {LockOutlined, UserOutlined} from "@ant-design/icons";
import {useLanguage} from '../../i18n/LanguageContext';

const AddOrganization = ({visible, setVisible, onFinish}) => {
    const {t} = useLanguage();

    return (
        <ModalForm
            visible={visible}
            setVisible={setVisible}
            onFinish={onFinish}
            title={t.addOrganization}
        >
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
                <Input/>
            </Form.Item>

            <Form.Item
                label={t.identificationNumber}
                name="identification_number"
                rules={[
                    {
                        required: true,
                        message: t.idNumberRequired,
                    },
                ]}
            >
                <Input/>
            </Form.Item>

            <Form.Item
                label={t.employeesCount}
                name="employees_count"
                rules={[
                    {
                        required: true,
                        message: t.employeesCountRequired,
                    }
                ]}
            >
                <InputNumber/>
            </Form.Item>
            <Divider>{t.webService}</Divider>

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
                <Input/>
            </Form.Item>

            <Flex justify="space-between" gap="medium">
                <Form.Item
                    label={t.user}
                    name="web_service_username"
                    rules={[
                        {
                            required: false,
                            message: t.webServiceUsernameHint,
                        }
                    ]}
                >
                    <Input autoComplete="off" prefix={<UserOutlined/>}/>
                </Form.Item>
                <Form.Item
                    label={t.password}
                    name="web_service_password"
                    rules={[
                        {
                            required: false,
                            message: t.webServicePasswordHint,
                        }
                    ]}
                >
                    <Input.Password autoComplete="new-password" prefix={<LockOutlined/>}/>
                </Form.Item>
            </Flex>
            <Form.Item label={null}>
                <Button block type="primary" htmlType="submit" variant="solid" color="green">
                    {t.add}
                </Button>
            </Form.Item>
        </ModalForm>
    );
};

export default AddOrganization;

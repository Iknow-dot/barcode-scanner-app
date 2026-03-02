import React from 'react';
import ModalForm from "../ModalForm";
import {Button, Divider, Flex, Form, Input, InputNumber, Switch} from "antd";
import {LockOutlined, UserOutlined} from "@ant-design/icons";
import {useLanguage} from '../../i18n/LanguageContext';

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
            <Form.Item
                label={t.name}
                name="web_service_username"
                rules={[
                    {
                        required: false,
                        message: t.webServiceUsernameHint,
                    }
                ]}
            >
                <Input prefix={<UserOutlined/>}/>
            </Form.Item>

            <Flex gap="small">
                <Form.Item
                    style={{
                        flex: 1
                    }}
                    label={t.password}
                    name="web_service_password"
                    rules={[
                        {
                            required: false,
                            message: t.webServicePasswordHint,
                        }
                    ]}
                    extra={t.leaveEmptyPassword}
                >
                    <Input.Password prefix={<LockOutlined/>} autoComplete="new-password"/>
                </Form.Item>
                <Form.Item
                    label={t.clearPassword}
                    name="clear_password"
                >
                    <Switch/>
                </Form.Item>
            </Flex>

            <Form.Item label={null}>
                <Button block type="primary" htmlType="submit" variant="solid" color="green">
                    {t.save}
                </Button>
            </Form.Item>
        </ModalForm>
    );
};

export default EditOrganization;

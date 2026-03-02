import React from 'react';
import ModalForm from "../ModalForm";
import {Button, Divider, Flex, Form, Input, InputNumber, Switch} from "antd";
import {LockOutlined, UserOutlined} from "@ant-design/icons";

const EditOrganization = ({visible, setVisible, onFinish, object}) => {
    return (
        <ModalForm
            object={object}
            title="ორგანიზაციის რედაქტირება"
            visible={visible}
            setVisible={setVisible}
            onFinish={(data) => onFinish(data, object)}
        >
            <Form.Item
                label="ორგანიზაციის სახელი:"
                name="name"
                rules={[
                    {
                        required: true,
                        message: 'შეავსეთ ორგანიზაციის სახელი!',
                    },
                ]}
            >
                <Input/>
            </Form.Item>

            <Form.Item
                label="საიდენტიფიკაციო ნომერი"
                name="identification_number"
                rules={[
                    {
                        required: true,
                        message: 'შეავსეთ საიდენტიფიკაციო ნომერი!',
                    },
                ]}
            >
                <Input/>
            </Form.Item>

            <Form.Item
                label="თანამშრომლების რაოდენობა"
                name="employees_count"
                rules={[
                    {
                        required: true,
                        message: 'შეავსეთ თანამშრომლების რაოდენობა!',
                    }
                ]}
            >
                <InputNumber/>
            </Form.Item>
            <Divider>ვებ სერვისი</Divider>

            <Form.Item
                label="მისამართი"
                name="web_service_url"
                rules={[
                    {
                        required: true,
                        message: 'შეავსეთ ვებ სერვისის მისამართი!',
                    }
                ]}
            >
                <Input/>
            </Form.Item>
            <Form.Item
                label="სახელი"
                name="web_service_username"
                rules={[
                    {
                        required: false,
                        message: 'შეავსეთ მომხმარელის სახელი!',
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
                    label="პაროლი"
                    name="web_service_password"
                    rules={[
                        {
                            required: false,
                            message: 'შეავსეთ პაროლი!',
                        }
                    ]}
                    extra="Leave empty if you don't want to change the password"
                >
                    <Input.Password prefix={<LockOutlined/>} autoComplete="new-password"/>
                </Form.Item>
                <Form.Item
                    label="წაშლა"
                    name="clear_password"
                >
                    <Switch/>
                </Form.Item>
            </Flex>

            <Form.Item label={null}>
                <Button block type="primary" htmlType="submit" variant="solid" color="green">
                    შენახვა
                </Button>
            </Form.Item>
        </ModalForm>
    );
};

export default EditOrganization;

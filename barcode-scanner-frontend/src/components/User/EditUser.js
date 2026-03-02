import React, {useState, useEffect, useContext} from 'react';
import {organizationService, warehouseService} from '../../api';
import AuthContext from '../Auth/AuthContext';
import {Button, Form, Input, Select, Tag} from "antd";
import ModalForm from "../ModalForm";

const EditUser = ({visible, setVisible, onFinish, object}) => {
    const {authData} = useContext(AuthContext);

    const [organizations, setOrganizations] = useState([]);
    const [warehouses, setWarehouses] = useState([]);
    const [isCompanyAdmin, setIsCompanyAdmin] = useState(authData && authData.role === 'company_admin');

    useEffect(() => {
        const fetchData = async () => {
            if (authData?.role === 'internal_admin') {
                const result = await organizationService.getOrganizations();
                if (result.success) {
                    setOrganizations(result.data);
                }
            }

            if (authData?.role === 'company_admin') {
                const result = await warehouseService.getWarehouses();
                if (result.success) {
                    setWarehouses(result.data);
                }
                setIsCompanyAdmin(true);
            }
        };

        fetchData();
    }, [authData, object]);

    return (
        <ModalForm
            object={{
                username: object.username,
                email: object.email || '',
                role: object.role,
                first_name: object.first_name || '',
                last_name: object.last_name || '',
                is_active: object.is_active,
                organization: object.organization,
            }}
            name="editUser"
            visible={visible}
            setVisible={setVisible}
            footer={null}
            onFinish={(data) => onFinish(data, object)}
        >
            {authData?.role === 'internal_admin' && (
                <Tag color='blue' style={{marginBottom: '16px'}}>
                    {organizations.find(org => org.id === object.organization)?.name || 'N/A'}
                </Tag>
            )}
            <Form.Item
                label="მომხმარებელი"
                name="username"
                rules={[{required: true, message: 'გთხოვთ შეიყვანოთ მომხმარებელი!'}]}
            >
                <Input/>
            </Form.Item>

            <Form.Item
                label="ელ. ფოსტა"
                name="email"
                rules={[{required: false, type: 'email', message: 'გთხოვთ შეიყვანოთ სწორი ელ. ფოსტა!'}]}
            >
                <Input/>
            </Form.Item>

            <Form.Item
                label="პაროლი"
                name="password"
                rules={[{required: false, min: 8, message: 'პაროლი უნდა იყოს მინიმუმ 8 სიმბოლო!'}]}
                extra="თუ არ გსურთ პაროლის შეცვლა, დატოვეთ ცარიელი"
            >
                <Input.Password/>
            </Form.Item>

            <Form.Item
                label="როლი"
                name="role"
                rules={[{required: true, message: 'გთხოვთ აირჩიოთ როლი!'}]}
            >
                <Select>
                    <Select.Option value="company_user">company_user</Select.Option>
                    <Select.Option value="company_admin">company_admin</Select.Option>
                </Select>
            </Form.Item>

            <Form.Item label="სახელი" name="first_name">
                <Input/>
            </Form.Item>

            <Form.Item label="გვარი" name="last_name">
                <Input/>
            </Form.Item>

            <Form.Item label={null}>
                <Button block type="primary" htmlType="submit" variant="solid" color="green">
                    შენახვა
                </Button>
            </Form.Item>
        </ModalForm>
    );
};

export default EditUser;

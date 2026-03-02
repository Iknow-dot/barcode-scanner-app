import React, {useState, useEffect, useContext} from 'react';
import {userService, organizationService, warehouseService} from '../../api';
import AuthContext from '../Auth/AuthContext';
import {Button, Form, Input, Select, Space, Tag} from "antd";
import ModalForm, {RenderOption} from "../ModalForm";


const AddUserModal = ({visible, setVisible, onFinish, organization = null}) => {
    const {authData} = useContext(AuthContext);
    const [IPOptions, setIPOptions] = useState([]);
    const [organizations, setOrganizations] = useState([]);
    const [allWarehouses, setAllWarehouses] = useState([]);
    const [warehouses, setWarehouses] = useState([]);
    const [selectedOrg, setSelectedOrg] = useState(organization ? organization.id : null);
    const isCompanyAdmin = authData?.role === 'company_admin';
    const isInternalAdmin = authData?.role === 'internal_admin';

    useEffect(() => {
        const fetchData = async () => {
            if (isInternalAdmin) {
                const orgResult = await organizationService.getOrganizations();
                if (orgResult.success) {
                    setOrganizations(orgResult.data || []);
                }
                const whResult = await warehouseService.getWarehouses();
                if (whResult.success) {
                    setAllWarehouses(whResult.data || []);
                }
            } else if (isCompanyAdmin) {
                const result = await warehouseService.getWarehouses();
                if (result.success) {
                    setWarehouses(result.data);
                }
            }
        };
        fetchData();
    }, [authData, isInternalAdmin, isCompanyAdmin]);

    // Filter warehouses when organization changes (for internal_admin)
    useEffect(() => {
        if (isInternalAdmin && selectedOrg) {
            setWarehouses(allWarehouses.filter(wh => wh.organization === selectedOrg));
        } else if (isInternalAdmin) {
            setWarehouses([]);
        }
    }, [selectedOrg, allWarehouses, isInternalAdmin]);

    useEffect(() => {
        const fetchIp = async () => {
            const result = await userService.getClientIp();
            if (result.success) {
                const ip = result.data.ip;
                setIPOptions((prevState) => [
                    ...prevState.filter((option) => option.value !== ip),
                    {label: ip, value: ip, desc: `თქვენი IP მისამართი: ${ip}`, emoji: '🌐'}
                ]);
            }
        };
        fetchIp();
    }, []);

    return (
        <ModalForm
            visible={visible}
            setVisible={setVisible}
            onFinish={onFinish}
            title="მომხმარებლის დამატება"
            name="addUser"
        >
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

            <Form.Item label="სახელი" name="first_name">
                <Input/>
            </Form.Item>

            <Form.Item label="გვარი" name="last_name">
                <Input/>
            </Form.Item>

            <Form.Item
                label="პაროლი"
                name="password"
                rules={[
                    {required: true, message: 'გთხოვთ შეიყვანოთ პაროლი!'},
                    {min: 8, message: 'პაროლი უნდა იყოს მინიმუმ 8 სიმბოლო!'},
                ]}
            >
                <Input.Password/>
            </Form.Item>

            <Form.Item
                label="როლი"
                name="role"
                rules={[{required: true, message: 'გთხოვთ აირჩიოთ როლი!'}]}
                initialValue={isCompanyAdmin ? 'company_user' : 'company_admin'}
            >
                <Select>
                    {isCompanyAdmin ? (
                        <Select.Option value="company_user">company_user</Select.Option>
                    ) : (
                        <>
                            <Select.Option value="company_admin">company_admin</Select.Option>
                            <Select.Option value="company_user">company_user</Select.Option>
                        </>
                    )}
                </Select>
            </Form.Item>

            <Form.Item
                label="IP მისამართი"
                name="ip_address"
                rules={[{required: false, message: 'გთხოვთ შეიყვანოთ IP მისამართი!'}]}
            >
                <Select
                    options={IPOptions}
                    mode="tags"
                    placeholder="IP მისამართი"
                    optionRender={(option) => (
                        <Space>
                            <span role="img">{option.data?.emoji}</span>
                            {option.data?.desc || option.data?.label}
                        </Space>
                    )}
                    tagRender={(props) => (
                        <Tag color='green'>{props.label}</Tag>
                    )}
                />
            </Form.Item>

            {isInternalAdmin && (
                <Form.Item
                    label="ორგანიზაცია"
                    name="organization"
                    rules={[{required: true, message: 'გთხოვთ აირჩიოთ ორგანიზაცია!'}]}
                    initialValue={organization ? organization.id : null}
                >
                    <Select
                        options={organizations.map(org => ({
                            label: org.name,
                            value: org.id,
                            emoji: '🏢',
                            desc: org.name
                        }))}
                        placeholder="აირჩიეთ ორგანიზაცია"
                        optionRender={RenderOption}
                        tagRender={(props) => (
                            <Tag color='green'>{props.label}</Tag>
                        )}
                        filterOption={(input, option) =>
                            option?.label.toLowerCase().includes(input.toLowerCase())
                        }
                        onChange={(value) => setSelectedOrg(value)}
                    />
                </Form.Item>
            )}

            {(isCompanyAdmin || isInternalAdmin) && (
                <Form.Item
                    label="საწყობები"
                    name="warehouse_ids"
                    rules={[{required: false, message: 'გთხოვთ აირჩიოთ საწყობი!'}]}
                >
                    <Select
                        mode="multiple"
                        options={warehouses.map(wh => ({
                            label: `${wh.name} (${wh.code})`,
                            value: wh.id,
                            emoji: '🏭',
                            desc: `${wh.name} (${wh.code})`
                        }))}
                        placeholder={isInternalAdmin && !selectedOrg ? "ჯერ აირჩიეთ ორგანიზაცია" : "აირჩიეთ საწყობები"}
                        disabled={isInternalAdmin && !selectedOrg}
                        optionRender={RenderOption}
                        tagRender={(props) => (
                            <Tag color='blue'>{props.label}</Tag>
                        )}
                        filterOption={(input, option) =>
                            option?.label.toLowerCase().includes(input.toLowerCase())
                        }
                    />
                </Form.Item>
            )}

            <Form.Item label={null}>
                <Button block type="primary" htmlType="submit" variant="solid" color="green">
                    დამატება
                </Button>
            </Form.Item>
        </ModalForm>
    );
};

export default AddUserModal;

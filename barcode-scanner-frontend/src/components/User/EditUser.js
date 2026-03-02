import React, {useState, useEffect, useContext} from 'react';
import {userService, organizationService, warehouseService} from '../../api';
import AuthContext from '../Auth/AuthContext';
import {Button, Form, Input, Select, Space, Tag} from "antd";
import ModalForm, {RenderOption} from "../ModalForm";

const EditUser = ({visible, setVisible, onFinish, object}) => {
    const {authData} = useContext(AuthContext);

    const [IPOptions, setIPOptions] = useState([]);
    const [organizations, setOrganizations] = useState([]);
    const [warehouses, setWarehouses] = useState([]);
    const isCompanyAdmin = authData?.role === 'company_admin';
    const isInternalAdmin = authData?.role === 'internal_admin';

    useEffect(() => {
        const fetchData = async () => {
            if (isInternalAdmin) {
                const orgResult = await organizationService.getOrganizations();
                if (orgResult.success) {
                    setOrganizations(orgResult.data || []);
                }
                // Fetch all warehouses, then filter by the edited user's organization
                const whResult = await warehouseService.getWarehouses();
                if (whResult.success) {
                    const filtered = object.organization
                        ? whResult.data.filter(wh => wh.organization === object.organization)
                        : whResult.data;
                    setWarehouses(filtered);
                }
            }

            if (isCompanyAdmin) {
                const result = await warehouseService.getWarehouses();
                if (result.success) {
                    setWarehouses(result.data);
                }
            }
        };

        fetchData();
    }, [authData, object, isInternalAdmin, isCompanyAdmin]);

    useEffect(() => {
        const fetchIpData = async () => {
            const newOptions = [];

            // Fetch client IP
            const clientIpResult = await userService.getClientIp();
            if (clientIpResult.success) {
                const ip = clientIpResult.data.ip;
                newOptions.push({label: ip, value: ip, desc: `თქვენი IP მისამართი: ${ip}`, emoji: '🌐'});
            }

            // Fetch organization IPs (use the edited user's organization or the admin's own)
            const orgId = isInternalAdmin ? object.organization : authData?.organization_id;
            if (orgId) {
                const orgIpsResult = await organizationService.getUsedIps(orgId);
                if (orgIpsResult.success && Array.isArray(orgIpsResult.data)) {
                    orgIpsResult.data.forEach(ip => {
                        if (!newOptions.some(opt => opt.value === ip)) {
                            newOptions.push({
                                label: ip,
                                value: ip,
                                desc: `ორგანიზაციაში გამოყენებული: ${ip}`,
                                emoji: '🏢'
                            });
                        }
                    });
                }
            }

            setIPOptions(newOptions);
        };
        fetchIpData();
    }, [object.organization, isInternalAdmin, authData?.organization_id]);

    // Extract IP addresses from allowed_ips array of objects
    const existingIps = (object.allowed_ips || []).map(ip => ip.ip_or_network);

    // Extract warehouse IDs from the user object (API returns warehouse_ids_read for reading)
    const existingWarehouseIds = (object.warehouse_ids_read || object.warehouse_ids || []);

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
                ip_address: existingIps,
                warehouse_ids: existingWarehouseIds,
            }}
            name="editUser"
            visible={visible}
            setVisible={setVisible}
            footer={null}
            onFinish={(data) => onFinish(data, object)}
        >
            {isInternalAdmin && (
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

            <Form.Item label="სახელი" name="first_name">
                <Input/>
            </Form.Item>

            <Form.Item label="გვარი" name="last_name">
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

            {(isCompanyAdmin || isInternalAdmin) && (
                <Form.Item
                    label="საწყობები"
                    name="warehouse_ids"
                >
                    <Select
                        mode="multiple"
                        options={warehouses.map(wh => ({
                            label: `${wh.name} (${wh.code})`,
                            value: wh.id,
                            emoji: '🏭',
                            desc: `${wh.name} (${wh.code})`
                        }))}
                        placeholder="აირჩიეთ საწყობები"
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
                    შენახვა
                </Button>
            </Form.Item>
        </ModalForm>
    );
};

export default EditUser;

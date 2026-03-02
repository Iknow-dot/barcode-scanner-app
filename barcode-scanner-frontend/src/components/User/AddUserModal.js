import React, {useState, useEffect, useContext} from 'react';
import {userService, organizationService, warehouseService} from '../../api';
import AuthContext from '../Auth/AuthContext';
import {Button, Form, Input, Select, Space, Tag} from "antd";
import ModalForm, {RenderOption} from "../ModalForm";
import {useLanguage} from '../../i18n/LanguageContext';


const AddUserModal = ({visible, setVisible, onFinish, organization = null}) => {
    const {authData} = useContext(AuthContext);
    const {t} = useLanguage();
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
        const fetchIpData = async () => {
            // Fetch client IP
            const clientIpResult = await userService.getClientIp();
            const newOptions = [];

            if (clientIpResult.success) {
                const ip = clientIpResult.data.ip;
                newOptions.push({label: ip, value: ip, desc: t.yourIp(ip), emoji: '🌐'});
            }

            // Fetch organization IPs
            const orgId = isInternalAdmin ? selectedOrg : authData?.organization_id;
            if (orgId) {
                const orgIpsResult = await organizationService.getUsedIps(orgId);
                if (orgIpsResult.success && Array.isArray(orgIpsResult.data)) {
                    orgIpsResult.data.forEach(ip => {
                        if (!newOptions.some(opt => opt.value === ip)) {
                            newOptions.push({
                                label: ip,
                                value: ip,
                                desc: t.orgUsedIp(ip),
                                emoji: '🏢'
                            });
                        }
                    });
                }
            }

            setIPOptions(newOptions);
        };
        fetchIpData();
    }, [selectedOrg, isInternalAdmin, authData?.organization_id, t]);

    return (
        <ModalForm
            visible={visible}
            setVisible={setVisible}
            onFinish={onFinish}
            title={t.addUser}
            name="addUser"
        >
            <Form.Item
                label={t.user}
                name="username"
                rules={[{required: true, message: t.usernameFieldRequired}]}
            >
                <Input/>
            </Form.Item>

            <Form.Item
                label={t.email}
                name="email"
                rules={[{required: false, type: 'email', message: t.emailInvalid}]}
            >
                <Input/>
            </Form.Item>

            <Form.Item label={t.firstName} name="first_name">
                <Input/>
            </Form.Item>

            <Form.Item label={t.lastName} name="last_name">
                <Input/>
            </Form.Item>

            <Form.Item
                label={t.password}
                name="password"
                rules={[
                    {required: true, message: t.passwordFieldRequired},
                    {min: 8, message: t.passwordMinLength},
                ]}
            >
                <Input.Password/>
            </Form.Item>

            <Form.Item
                label={t.role}
                name="role"
                rules={[{required: true, message: t.roleRequired}]}
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
                label={t.ipAddress}
                name="ip_address"
                rules={[{required: false, message: t.ipAddressHint}]}
            >
                <Select
                    options={IPOptions}
                    mode="tags"
                    placeholder={t.ipAddress}
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
                    label={t.organization}
                    name="organization"
                    rules={[{required: true, message: t.orgRequired}]}
                    initialValue={organization ? organization.id : null}
                >
                    <Select
                        options={organizations.map(org => ({
                            label: org.name,
                            value: org.id,
                            emoji: '🏢',
                            desc: org.name
                        }))}
                        placeholder={t.selectOrganization}
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
                    label={t.warehouses}
                    name="warehouse_ids"
                    rules={[{required: false, message: t.warehouseHint}]}
                >
                    <Select
                        mode="multiple"
                        options={warehouses.map(wh => ({
                            label: `${wh.name} (${wh.code})`,
                            value: wh.id,
                            emoji: '🏭',
                            desc: `${wh.name} (${wh.code})`
                        }))}
                        placeholder={isInternalAdmin && !selectedOrg ? t.selectOrgFirst : t.selectWarehouses}
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
                    {t.add}
                </Button>
            </Form.Item>
        </ModalForm>
    );
};

export default AddUserModal;

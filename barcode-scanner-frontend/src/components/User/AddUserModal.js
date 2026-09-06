import React, {useState, useEffect, useContext} from 'react';
import {userService, organizationService, warehouseService} from '../../api';
import AuthContext from '../Auth/AuthContext';
import {Button, Divider, Flex, Form, Input, InputNumber, Select, Space, Switch, Tag, theme, Tooltip} from "antd";
import ModalForm, {RenderOption, useModalFormLoading} from "../ModalForm";
import {PlusOutlined, UserOutlined, LockOutlined, MailOutlined, SafetyCertificateOutlined, PercentageOutlined, MobileOutlined} from "@ant-design/icons";
import {useLanguage} from '../../i18n/LanguageContext';


const roleTagColors = {
    company_admin: 'green',
    company_user: 'geekblue',
};

const RoleOption = ({label, desc}) => {
    const {token} = theme.useToken();
    return (
        <div style={{padding: '2px 0'}}>
            <div style={{fontWeight: 500, lineHeight: 1.3}}>{label}</div>
            {desc && (
                <div style={{fontSize: 12, color: token.colorTextTertiary, marginTop: 2, lineHeight: 1.3}}>
                    {desc}
                </div>
            )}
        </div>
    );
};

const AddUserForm = ({organization = null}) => {
    const {authData} = useContext(AuthContext);
    const {t} = useLanguage();
    const {loading} = useModalFormLoading();
    const {token} = theme.useToken();
    const [IPOptions, setIPOptions] = useState([]);
    const [organizations, setOrganizations] = useState([]);
    const [allWarehouses, setAllWarehouses] = useState([]);
    const [warehouses, setWarehouses] = useState([]);
    const [selectedOrg, setSelectedOrg] = useState(organization ? organization.id : null);
    const [restrictByIp, setRestrictByIp] = useState(false);
    const form = Form.useFormInstance();
    const canApplyDiscount = Form.useWatch('can_apply_discount', form);
    const roleValue = Form.useWatch('role', form);

    // Device lock defaults ON for company users, OFF for admins.
    useEffect(() => {
        form.setFieldValue('device_lock_enabled', roleValue === 'company_user');
    }, [roleValue, form]);

    const isCompanyAdmin = authData?.role === 'company_admin';
    const isInternalAdmin = authData?.role === 'internal_admin';

    const roleOptions = (isCompanyAdmin
        ? [{value: 'company_user', label: t.roleCompanyUser, desc: t.roleCompanyUserDesc}]
        : [
            {value: 'company_admin', label: t.roleCompanyAdmin, desc: t.roleCompanyAdminDesc},
            {value: 'company_user', label: t.roleCompanyUser, desc: t.roleCompanyUserDesc},
        ]);

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
        <>
            <Flex gap={16}>
                <Form.Item
                    label={t.user}
                    name="username"
                    style={{flex: 1}}
                    rules={[{required: true, message: t.usernameFieldRequired}]}
                >
                    <Input prefix={<UserOutlined style={{opacity: 0.4}}/>} placeholder={t.user}/>
                </Form.Item>

                <Form.Item
                    label={t.email}
                    name="email"
                    style={{flex: 1}}
                    rules={[{required: false, type: 'email', message: t.emailInvalid}]}
                >
                    <Input prefix={<MailOutlined style={{opacity: 0.4}}/>} placeholder={t.email}/>
                </Form.Item>
            </Flex>

            <Flex gap={16}>
                <Form.Item label={t.firstName} name="first_name" style={{flex: 1}}>
                    <Input placeholder={t.firstName}/>
                </Form.Item>

                <Form.Item label={t.lastName} name="last_name" style={{flex: 1}}>
                    <Input placeholder={t.lastName}/>
                </Form.Item>
            </Flex>

            <Flex gap={16}>
                <Form.Item
                    label={t.password}
                    name="password"
                    style={{flex: 1}}
                    rules={[
                        {required: true, message: t.passwordFieldRequired},
                        {min: 8, message: t.passwordMinLength},
                    ]}
                >
                    <Input.Password prefix={<LockOutlined style={{opacity: 0.4}}/>}/>
                </Form.Item>

                <Form.Item
                    label={t.role}
                    name="role"
                    style={{flex: 1}}
                    rules={[{required: true, message: t.roleRequired}]}
                    initialValue={isCompanyAdmin ? 'company_user' : 'company_admin'}
                >
                    <Select
                        options={roleOptions}
                        optionRender={(option) => (
                            <RoleOption label={option.data.label} desc={option.data.desc}/>
                        )}
                        labelRender={(option) => {
                            const value = option.value;
                            return (
                                <Tag color={roleTagColors[value]} style={{margin: 0, fontWeight: 500}}>
                                    {option.label}
                                </Tag>
                            );
                        }}
                    />
                </Form.Item>
            </Flex>

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
                        showSearch
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

            <Divider style={{margin: '4px 0 16px'}} dashed/>

            <Flex align="center" justify="space-between" style={{marginBottom: restrictByIp ? 12 : 0}}>
                <Space>
                    <SafetyCertificateOutlined style={{color: '#1677ff', fontSize: 16}}/>
                    <span style={{fontWeight: 500}}>{t.restrictByIp}</span>
                    <Tooltip title={t.restrictByIpHint}>
                        <span style={{fontSize: 12, color: token.colorTextTertiary, cursor: 'help'}}>?</span>
                    </Tooltip>
                </Space>
                <Switch
                    checked={restrictByIp}
                    onChange={(checked) => {
                        setRestrictByIp(checked);
                        // A `hidden` Form.Item is still collected on submit; clear it so
                        // the payload carries allowed_ips: [] (server: [] clears, absent
                        // leaves the rows alone).
                        if (!checked) form.setFieldValue('ip_address', []);
                    }}
                    size="small"
                />
            </Flex>

            <Form.Item
                label={null}
                name="ip_address"
                hidden={!restrictByIp}
                style={{marginBottom: restrictByIp ? undefined : 0}}
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

            <Divider style={{margin: '4px 0 16px'}} dashed/>

            <Flex align="center" justify="space-between">
                <Space>
                    <MobileOutlined style={{color: '#1677ff', fontSize: 16}}/>
                    <span style={{fontWeight: 500}}>{t.deviceLock}</span>
                    <Tooltip title={t.deviceLockHint}>
                        <span style={{fontSize: 12, color: token.colorTextTertiary, cursor: 'help'}}>?</span>
                    </Tooltip>
                </Space>
                <Form.Item
                    name="device_lock_enabled"
                    valuePropName="checked"
                    initialValue={isCompanyAdmin}
                    noStyle
                >
                    <Switch size="small"/>
                </Form.Item>
            </Flex>

            <Divider style={{margin: '4px 0 16px'}} dashed/>

            <Flex align="center" justify="space-between" style={{marginBottom: canApplyDiscount ? 12 : 0}}>
                <Space>
                    <PercentageOutlined style={{color: '#1677ff', fontSize: 16}}/>
                    <span style={{fontWeight: 500}}>{t.canApplyDiscount}</span>
                    <Tooltip title={t.canApplyDiscountHint}>
                        <span style={{fontSize: 12, color: token.colorTextTertiary, cursor: 'help'}}>?</span>
                    </Tooltip>
                </Space>
                <Form.Item
                    name="can_apply_discount"
                    valuePropName="checked"
                    initialValue={false}
                    noStyle
                >
                    <Switch size="small"/>
                </Form.Item>
            </Flex>

            <Form.Item
                label={t.maxDiscountPercent}
                name="max_discount_percent"
                hidden={!canApplyDiscount}
                initialValue={0}
                rules={[{type: 'number', min: 0, max: 100, message: t.maxDiscountRange}]}
            >
                <InputNumber
                    min={0}
                    max={100}
                    step={1}
                    style={{width: '100%'}}
                    addonAfter="%"
                />
            </Form.Item>

            <Form.Item label={null} style={{marginTop: 16, marginBottom: 0}}>
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

const AddUserModal = ({visible, setVisible, onFinish, organization = null}) => {
    const {t} = useLanguage();

    return (
        <ModalForm
            visible={visible}
            setVisible={setVisible}
            onFinish={onFinish}
            title={t.addUser}
            name="addUser"
        >
            <AddUserForm organization={organization}/>
        </ModalForm>
    );
};

export default AddUserModal;

import React, {useState, useEffect, useContext} from 'react';
import {userService, organizationService, warehouseService} from '../../api';
import AuthContext from '../Auth/AuthContext';
import {Button, Divider, Flex, Form, Input, Select, Space, Switch, Tag, Tooltip} from "antd";
import ModalForm, {RenderOption, useModalFormLoading} from "../ModalForm";
import {SaveOutlined, UserOutlined, LockOutlined, MailOutlined, SafetyCertificateOutlined} from "@ant-design/icons";
import {useLanguage} from '../../i18n/LanguageContext';

const roleTagColors = {
    company_admin: 'green',
    company_user: 'geekblue',
};

const RoleOption = ({label, desc}) => (
    <div style={{padding: '2px 0'}}>
        <div style={{fontWeight: 500, lineHeight: 1.3}}>{label}</div>
        {desc && (
            <div style={{fontSize: 12, color: 'rgba(0, 0, 0, 0.45)', marginTop: 2, lineHeight: 1.3}}>
                {desc}
            </div>
        )}
    </div>
);

const EditUserForm = ({object, hasExistingIps}) => {
    const {authData} = useContext(AuthContext);
    const {t} = useLanguage();
    const {loading} = useModalFormLoading();

    const [IPOptions, setIPOptions] = useState([]);
    const [organizations, setOrganizations] = useState([]);
    const [warehouses, setWarehouses] = useState([]);
    const [restrictByIp, setRestrictByIp] = useState(hasExistingIps);
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
                newOptions.push({label: ip, value: ip, desc: t.yourIp(ip), emoji: '🌐'});
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
    }, [object.organization, isInternalAdmin, authData?.organization_id, t]);

    const isSelf = object.id === authData?.user?.id;

    return (
        <>
            {isInternalAdmin && (
                <Tag color='blue' style={{marginBottom: 16, padding: '4px 12px', fontSize: 13}}>
                    🏢 {organizations.find(org => org.id === object.organization)?.name || 'N/A'}
                </Tag>
            )}

            <Flex gap={16}>
                <Form.Item
                    label={t.user}
                    name="username"
                    style={{flex: 1}}
                    rules={[{required: true, message: t.usernameFieldRequired}]}
                >
                    <Input prefix={<UserOutlined style={{opacity: 0.4}}/>}/>
                </Form.Item>

                <Form.Item
                    label={t.email}
                    name="email"
                    style={{flex: 1}}
                    rules={[{required: false, type: 'email', message: t.emailInvalid}]}
                >
                    <Input prefix={<MailOutlined style={{opacity: 0.4}}/>}/>
                </Form.Item>
            </Flex>

            <Flex gap={16}>
                <Form.Item label={t.firstName} name="first_name" style={{flex: 1}}>
                    <Input/>
                </Form.Item>

                <Form.Item label={t.lastName} name="last_name" style={{flex: 1}}>
                    <Input/>
                </Form.Item>
            </Flex>

            <Flex gap={16}>
                <Form.Item
                    label={t.password}
                    name="password"
                    style={{flex: 1}}
                    rules={[{required: false, min: 8, message: t.passwordMinLength}]}
                    extra={<span style={{fontSize: 12, opacity: 0.5}}>{t.passwordLeaveEmpty}</span>}
                >
                    <Input.Password prefix={<LockOutlined style={{opacity: 0.4}}/>}/>
                </Form.Item>

                <Form.Item
                    label={t.role}
                    name="role"
                    style={{flex: 1}}
                    rules={[{required: true, message: t.roleRequired}]}
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

            {(isCompanyAdmin || isInternalAdmin) && (
                <Form.Item
                    label={t.warehouses}
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
                        placeholder={t.selectWarehouses}
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

            <Form.Item
                label={null}
                name="is_active"
                valuePropName="checked"
                style={{marginBottom: 12}}
            >
                <ActiveToggle isSelf={isSelf} t={t}/>
            </Form.Item>

            <Flex align="center" justify="space-between" style={{marginBottom: restrictByIp ? 12 : 0}}>
                <Space>
                    <SafetyCertificateOutlined style={{color: '#1677ff', fontSize: 16}}/>
                    <span style={{fontWeight: 500}}>{t.restrictByIp}</span>
                    <Tooltip title={t.restrictByIpHint}>
                        <span style={{fontSize: 12, color: 'rgba(0,0,0,0.45)', cursor: 'help'}}>?</span>
                    </Tooltip>
                </Space>
                <Switch
                    checked={restrictByIp}
                    onChange={setRestrictByIp}
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

            <Form.Item label={null} style={{marginTop: 16, marginBottom: 0}}>
                <Button
                    block
                    type="primary"
                    htmlType="submit"
                    loading={loading}
                    icon={<SaveOutlined/>}
                    style={{height: 44, fontWeight: 600}}
                >
                    {t.save}
                </Button>
            </Form.Item>
        </>
    );
};

// Custom control so the row reads as one unit and disables the toggle when
// editing yourself (mirrors the inline-table behaviour).
// Form.Item with valuePropName="checked" injects `checked` + `onChange`.
const ActiveToggle = ({checked, onChange, isSelf, t}) => {
    const control = (
        <Switch
            checked={!!checked}
            onChange={onChange}
            disabled={isSelf}
        />
    );
    return (
        <Flex align="center" justify="space-between" style={{padding: '4px 0'}}>
            <Space>
                <span style={{fontWeight: 500}}>{t.userStatus}</span>
                <Tag color={checked ? 'success' : 'default'} style={{margin: 0}}>
                    {checked ? t.userActive : t.userDisabled}
                </Tag>
            </Space>
            {isSelf ? <Tooltip title={t.cannotDeleteSelf}>{control}</Tooltip> : control}
        </Flex>
    );
};

const EditUser = ({visible, setVisible, onFinish, object}) => {
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
            <EditUserForm object={object} hasExistingIps={existingIps.length > 0}/>
        </ModalForm>
    );
};

export default EditUser;

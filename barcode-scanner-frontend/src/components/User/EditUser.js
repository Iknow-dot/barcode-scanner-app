import React, {useState, useEffect, useContext, useMemo} from 'react';
import {userService, organizationService, warehouseService} from '../../api';
import AuthContext from '../Auth/AuthContext';
import {Button, Divider, Flex, Form, Input, InputNumber, Popconfirm, Select, Space, Switch, Tag, theme, Tooltip} from "antd";
import ModalForm, {RenderOption, useModalFormLoading} from "../ModalForm";
import {SaveOutlined, UserOutlined, LockOutlined, MailOutlined, SafetyCertificateOutlined, PercentageOutlined, MobileOutlined} from "@ant-design/icons";
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

const EditUserForm = ({object, hasExistingIps, onDeviceReset}) => {
    const {authData} = useContext(AuthContext);
    const {t} = useLanguage();
    const {loading} = useModalFormLoading();
    const {token} = theme.useToken();

    const [IPOptions, setIPOptions] = useState([]);
    const [organizations, setOrganizations] = useState([]);
    const [warehouses, setWarehouses] = useState([]);
    const [restrictByIp, setRestrictByIp] = useState(hasExistingIps);
    const [deviceInfo, setDeviceInfo] = useState({
        bound: !!object.has_bound_device,
        boundAt: object.device_bound_at,
        label: object.device_label,
    });
    const [resettingDevice, setResettingDevice] = useState(false);
    const form = Form.useFormInstance();
    const canApplyDiscount = Form.useWatch('can_apply_discount', form);

    const handleResetDevice = async () => {
        setResettingDevice(true);
        const result = await userService.resetDevice(object.id);
        setResettingDevice(false);
        if (result.success) {
            setDeviceInfo({bound: false, boundAt: null, label: ''});
            if (onDeviceReset) onDeviceReset(result.data, null);
        } else if (onDeviceReset) {
            onDeviceReset(null, result.error);
        }
    };
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

            <Flex align="center" justify="space-between" style={{marginBottom: 8}}>
                <Space>
                    <MobileOutlined style={{color: '#1677ff', fontSize: 16}}/>
                    <span style={{fontWeight: 500}}>{t.deviceLock}</span>
                    <Tooltip title={t.deviceLockHint}>
                        <span style={{fontSize: 12, color: token.colorTextTertiary, cursor: 'help'}}>?</span>
                    </Tooltip>
                </Space>
                <Form.Item name="device_lock_enabled" valuePropName="checked" noStyle>
                    <Switch size="small"/>
                </Form.Item>
            </Flex>

            <Flex align="center" justify="space-between">
                {deviceInfo.bound ? (
                    <Space direction="vertical" size={0}>
                        <span style={{fontSize: 12}}>{t.boundDevice}</span>
                        <span style={{fontSize: 12, color: token.colorTextTertiary}}>
                            {(deviceInfo.label || '—').slice(0, 60)}
                            {deviceInfo.boundAt ? ` · ${new Date(deviceInfo.boundAt).toLocaleDateString()}` : ''}
                        </span>
                    </Space>
                ) : (
                    <span style={{fontSize: 12, color: token.colorTextTertiary}}>{t.noDeviceBound}</span>
                )}
                {deviceInfo.bound && (
                    <Popconfirm
                        title={t.resetDeviceConfirm}
                        onConfirm={handleResetDevice}
                        okText={t.resetDevice}
                        cancelText={t.no}
                    >
                        <Button size="small" danger loading={resettingDevice}>
                            {t.resetDevice}
                        </Button>
                    </Popconfirm>
                )}
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
                    noStyle
                >
                    <Switch size="small"/>
                </Form.Item>
            </Flex>

            <Form.Item
                label={t.maxDiscountPercent}
                name="max_discount_percent"
                hidden={!canApplyDiscount}
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

const EditUser = ({visible, setVisible, onFinish, object, onDeviceReset}) => {
    // Extract IP addresses from allowed_ips array of objects
    const existingIps = (object.allowed_ips || []).map(ip => ip.ip_or_network);

    // Memoized: ModalForm re-seeds the form whenever this object's identity
    // changes, so a fresh literal per render would wipe unsaved edits on any
    // parent re-render — e.g. Reset device inside this very modal re-renders
    // UsersTab and would silently restore an IP list the admin just cleared.
    const formObject = useMemo(() => ({
        username: object.username,
        email: object.email || '',
        role: object.role,
        first_name: object.first_name || '',
        last_name: object.last_name || '',
        is_active: object.is_active,
        organization: object.organization,
        ip_address: (object.allowed_ips || []).map(ip => ip.ip_or_network),
        // API returns warehouse_ids_read for reading
        warehouse_ids: (object.warehouse_ids_read || object.warehouse_ids || []),
        can_apply_discount: !!object.can_apply_discount,
        max_discount_percent: Number(object.max_discount_percent || 0),
        device_lock_enabled: !!object.device_lock_enabled,
    }), [object]);

    return (
        <ModalForm
            object={formObject}
            name="editUser"
            visible={visible}
            setVisible={setVisible}
            footer={null}
            onFinish={(data) => onFinish(data, object)}
        >
            <EditUserForm object={object} hasExistingIps={existingIps.length > 0} onDeviceReset={onDeviceReset}/>
        </ModalForm>
    );
};

export default EditUser;

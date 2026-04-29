import React, {useContext, useEffect, useMemo, useRef, useState} from 'react';
import {userService, organizationService} from '../../api';
import {Avatar, Button, Col, Empty, Flex, Input, Popconfirm, Progress, Row, Select, Space, Tag, Tooltip, Typography} from "antd";
import DataTab from "../DataTab";
import AuthContext from "../Auth/AuthContext";
import AddUserModal from "../User/AddUserModal";
import EditUserModal from "../User/EditUser";
import {CheckOutlined, CloseOutlined, ClearOutlined, SearchOutlined} from "@ant-design/icons";
import useAppNotification from "../../hooks/useAppNotification";
import {useLanguage} from '../../i18n/LanguageContext';

const {Text} = Typography;

const roleColors = {
    internal_admin: "red",
    company_admin: "green",
    company_user: "geekblue"
};

// Avatar background palette — matches the role tag color family but tuned
// for legibility against white initials.
const roleAvatarBg = {
    internal_admin: '#cf1322',
    company_admin: '#389e0d',
    company_user: '#2f54eb',
};

const initialsFor = (user) => {
    const f = (user.first_name || '').trim();
    const l = (user.last_name || '').trim();
    if (f || l) return `${(f[0] || '')}${(l[0] || '')}`.toUpperCase();
    const u = (user.username || '').trim();
    return u ? u[0].toUpperCase() : '?';
};

const UsersTab = ({initialUsers, initialLoading = false, addModalExtraProps, handleEditCallback = null, filtersEnabled = false}) => {
    const {authData} = useContext(AuthContext);
    const {notify, contextHolder} = useAppNotification();
    const {t} = useLanguage();
    const [users, setUsers] = useState(initialUsers || []);
    const [loading, setLoading] = useState(initialLoading);
    const [organizations, setOrganizations] = useState({});
    const [orgOptions, setOrgOptions] = useState([]);
    const [query, setQuery] = useState('');
    const [selectedOrg, setSelectedOrg] = useState(null);
    const [selectedRole, setSelectedRole] = useState(null);
    const [statusBusyId, setStatusBusyId] = useState(null);
    const [employeesLimit, setEmployeesLimit] = useState(null);

    const isInternalAdmin = authData?.role === 'internal_admin';
    const isCompanyAdmin = authData?.role === 'company_admin';

    const roleLabels = useMemo(() => ({
        internal_admin: t.roleInternalAdmin,
        company_admin: t.roleCompanyAdmin,
        company_user: t.roleCompanyUser,
    }), [t]);

    const roleOptions = Object.keys(roleColors).map(r => ({
        value: r,
        label: (
            <Flex align="center" gap={6}>
                <Tag color={roleColors[r]} style={{margin: 0}}>{roleLabels[r] || r}</Tag>
            </Flex>
        ),
    }));

    // debounce timer ref
    const debounceTimer = useRef(null);
    const DEBOUNCE_MS = 300;

    useEffect(() => {
        const fetchOrganizations = async () => {
            const result = await organizationService.getOrganizations();
            if (result.success) {
                const orgMap = result.data.reduce((acc, org) => {
                    acc[org.id] = org.name;
                    return acc;
                }, {});
                setOrganizations(orgMap);
                setOrgOptions(result.data.map(org => ({value: org.id, label: org.name})));
            }
        };
        if (isInternalAdmin) {
            fetchOrganizations();
        }
    }, [isInternalAdmin]);

    // Fetch own org's employee cap so we can render "X / Y users".
    useEffect(() => {
        if (!isCompanyAdmin) return;
        const fetchMyOrg = async () => {
            const result = await organizationService.getMyOrganization();
            if (result.success && result.data?.employees_count != null) {
                setEmployeesLimit(result.data.employees_count);
            }
        };
        fetchMyOrg();
    }, [isCompanyAdmin]);

    useEffect(() => setUsers(initialUsers || []), [initialUsers]);
    useEffect(() => setLoading(initialLoading), [initialLoading]);

    const fetchUsers = async (params = {}) => {
        setLoading(true);
        try {
            const result = await userService.getUsers(params);
            if (result.success) {
                setUsers(result.data);
            }
        } finally {
            setLoading(false);
        }
    };

    // immediate search trigger
    const handleSearch = () => {
        const params = {};
        if (query && query.trim() !== '') params.search = query.trim();
        if (selectedOrg) params.organization = selectedOrg;
        if (selectedRole) params.role = selectedRole;
        fetchUsers(params);
    };

    // debounced handler for input changes
    const handleQueryChange = (value) => {
        setQuery(value);
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => {
            const params = {};
            if (value && value.trim() !== '') params.search = value.trim();
            if (selectedOrg) params.organization = selectedOrg;
            if (selectedRole) params.role = selectedRole;
            fetchUsers(params);
        }, DEBOUNCE_MS);
    };

    // selection changes should trigger immediate search
    const handleOrgChange = (value) => {
        setSelectedOrg(value);
        const params = {};
        if (query && query.trim() !== '') params.search = query.trim();
        if (value) params.organization = value;
        if (selectedRole) params.role = selectedRole;
        fetchUsers(params);
    };

    const handleRoleChange = (value) => {
        setSelectedRole(value);
        const params = {};
        if (query && query.trim() !== '') params.search = query.trim();
        if (selectedOrg) params.organization = selectedOrg;
        if (value) params.role = value;
        fetchUsers(params);
    };

    const handleClearFilters = () => {
        setQuery('');
        setSelectedOrg(null);
        setSelectedRole(null);
        fetchUsers();
    };

    const hasActiveFilters = query || selectedOrg || selectedRole;

    const handleAdd = async (newUser) => {
        const payload = {
            username: newUser.username,
            password: newUser.password,
            role: newUser.role || 'company_user',
            email: newUser.email || '',
            first_name: newUser.first_name || '',
            last_name: newUser.last_name || '',
        };

        if (newUser.organization) {
            payload.organization = newUser.organization;
        }

        if (newUser.ip_address && newUser.ip_address.length > 0) {
            payload.allowed_ips = newUser.ip_address.map(ip => ({ip_or_network: ip}));
        }

        if (newUser.warehouse_ids && newUser.warehouse_ids.length > 0) {
            payload.warehouse_ids = newUser.warehouse_ids;
        }

        const result = await userService.createUser(payload);

        if (result.success) {
            setUsers(prev => [...prev, result.data]);
            notify.success(t.success, t.userCreated(newUser.username));
            return true;
        }

        if (result.code === 'USER_LIMIT_REACHED') {
            notify.error(t.error, t.userLimitReached);
        } else {
            notify.error(t.error, result.error);
        }
        return false;
    };

    const handleDelete = async (deleteUser) => {
        if (deleteUser.id === authData?.user?.id) {
            notify.error(t.error, t.cannotDeleteSelf);
            return false;
        }

        const result = await userService.deleteUser(deleteUser.id);

        if (result.success) {
            setUsers(prev => prev.filter(u => u.id !== deleteUser.id));
            notify.success(t.success, t.userDeleted(deleteUser.username));
        } else {
            notify.error(t.error, result.error);
        }
    };

    const handleEdit = async (modifiedFields, editUser) => {
        const payload = {
            ...modifiedFields,
        };

        if (!payload.password) {
            delete payload.password;
        }

        // Format allowed_ips from the ip_address field (array of strings → array of objects)
        if (payload.ip_address !== undefined) {
            payload.allowed_ips = (payload.ip_address || []).map(ip => ({ip_or_network: ip}));
            delete payload.ip_address;
        }

        // Ensure warehouse_ids is an array
        if (payload.warehouse_ids !== undefined) {
            payload.warehouse_ids = payload.warehouse_ids || [];
        }

        const result = await userService.updateUser(editUser.id, payload);

        if (result.success) {
            const updatedUser = result.data;
            setUsers(prev => prev.map(u => u.id === editUser.id ? updatedUser : u));
            notify.success(t.success, t.userUpdated(editUser.username));
            if (handleEditCallback) handleEditCallback(updatedUser, modifiedFields, editUser);
            return true;
        }

        notify.error(t.error, result.error);
        return false;
    };

    const handleToggleActive = async (user) => {
        if (user.id === authData?.user?.id) {
            notify.error(t.error, t.cannotDeleteSelf);
            return;
        }
        setStatusBusyId(user.id);
        const next = !user.is_active;
        try {
            const result = await userService.updateUser(user.id, {is_active: next});
            if (result.success) {
                setUsers(prev => prev.map(u => u.id === user.id ? result.data : u));
                notify.success(
                    t.success,
                    next ? t.userActivated(user.username) : t.userDeactivated(user.username),
                );
            } else {
                notify.error(t.error, result.error);
            }
        } finally {
            setStatusBusyId(null);
        }
    };

    // Current company-user count for company admins (matches backend
    // Organization.non_admin_user_count). For internal admin we don't show
    // the limit pill at all.
    const companyUserCount = useMemo(
        () => users.filter(u => u.role === 'company_user').length,
        [users],
    );
    const showLimit = isCompanyAdmin && employeesLimit != null;
    const limitReached = showLimit && companyUserCount >= employeesLimit;
    const limitPercent = showLimit ? Math.min(100, Math.round((companyUserCount / employeesLimit) * 100)) : 0;
    const limitStrokeColor = limitReached ? '#ff4d4f' : (limitPercent >= 80 ? '#faad14' : '#52c41a');

    const renderEmpty = () => {
        const filtered = !!hasActiveFilters;
        return (
            <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                styles={{image: {height: 56, marginTop: 24}}}
                description={
                    <div style={{padding: '4px 0 12px'}}>
                        <div style={{fontWeight: 500, color: 'rgba(0,0,0,0.75)', marginBottom: 4}}>
                            {filtered ? t.noFilterMatchTitle : t.noUsersTitle}
                        </div>
                        <Text type="secondary" style={{fontSize: 13}}>
                            {filtered ? t.noFilterMatchDescription : t.noUsersDescription}
                        </Text>
                    </div>
                }
            >
                {filtered ? (
                    <Button icon={<ClearOutlined/>} onClick={handleClearFilters}>{t.clear}</Button>
                ) : null}
            </Empty>
        );
    };

    return (
        <>
            {contextHolder}

            {isInternalAdmin && filtersEnabled && (
                <div className="filter-bar">
                    <Row gutter={[12, 12]} align="middle">
                        <Col xs={24} sm={24} md={8}>
                            <Input
                                placeholder={t.searchUsersPlaceholder}
                                allowClear
                                value={query}
                                onChange={e => handleQueryChange(e.target.value)}
                                onPressEnter={() => {
                                    if (debounceTimer.current) clearTimeout(debounceTimer.current);
                                    handleSearch();
                                }}
                                prefix={<SearchOutlined style={{opacity: 0.4}}/>}
                                style={{height: 32}}
                            />
                        </Col>
                        <Col xs={24} sm={12} md={6}>
                            <Select
                                showSearch
                                placeholder={t.filterOrganization}
                                options={orgOptions}
                                onChange={handleOrgChange}
                                value={selectedOrg}
                                allowClear
                                style={{width: '100%'}}
                                filterOption={(input, option) =>
                                    option?.label?.toLowerCase().includes(input.toLowerCase())
                                }
                            />
                        </Col>
                        <Col xs={24} sm={12} md={5}>
                            <Select
                                showSearch
                                placeholder={t.filterRole}
                                options={roleOptions}
                                onChange={handleRoleChange}
                                value={selectedRole}
                                allowClear
                                style={{width: '100%'}}
                            />
                        </Col>
                        <Col xs={24} sm={24} md={5}>
                            <Space>
                                <Button
                                    type="primary"
                                    icon={<SearchOutlined/>}
                                    onClick={() => {
                                        if (debounceTimer.current) clearTimeout(debounceTimer.current);
                                        handleSearch();
                                    }}
                                >
                                    {t.search}
                                </Button>
                                {hasActiveFilters && (
                                    <Button
                                        icon={<ClearOutlined/>}
                                        onClick={handleClearFilters}
                                    >
                                        {t.clear}
                                    </Button>
                                )}
                            </Space>
                        </Col>
                    </Row>
                </div>
            )}

            {showLimit && (
                <Flex
                    align="center"
                    gap={12}
                    style={{
                        padding: '10px 14px',
                        marginBottom: 12,
                        background: limitReached ? 'rgba(255, 77, 79, 0.06)' : 'rgba(0, 0, 0, 0.02)',
                        border: `1px solid ${limitReached ? 'rgba(255, 77, 79, 0.25)' : 'rgba(0, 0, 0, 0.06)'}`,
                        borderRadius: 8,
                    }}
                >
                    <Text style={{fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap'}}>
                        {t.userLimitProgress(companyUserCount, employeesLimit)}
                    </Text>
                    <Progress
                        percent={limitPercent}
                        showInfo={false}
                        strokeColor={limitStrokeColor}
                        size="small"
                        style={{flex: 1, margin: 0}}
                    />
                    {limitReached && (
                        <Text type="danger" style={{fontSize: 12, whiteSpace: 'nowrap'}}>
                            {t.userLimitFull}
                        </Text>
                    )}
                </Flex>
            )}

            <DataTab loading={loading} objects={users} columns={[
                {
                    key: 'identity',
                    title: t.user,
                    dataIndex: 'username',
                    render: (_, user) => {
                        const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
                        const muted = !user.is_active;
                        return (
                            <Flex align="center" gap={10} style={{opacity: muted ? 0.55 : 1}}>
                                <Avatar
                                    style={{
                                        backgroundColor: roleAvatarBg[user.role] || '#8c8c8c',
                                        color: '#fff',
                                        fontWeight: 600,
                                        flexShrink: 0,
                                    }}
                                    size={36}
                                >
                                    {initialsFor(user)}
                                </Avatar>
                                <div style={{minWidth: 0}}>
                                    <div style={{fontWeight: 500, lineHeight: 1.2}}>
                                        {user.username}
                                    </div>
                                    {(fullName || user.email) && (
                                        <div style={{
                                            fontSize: 12,
                                            color: 'rgba(0, 0, 0, 0.45)',
                                            lineHeight: 1.3,
                                            marginTop: 2,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            maxWidth: 280,
                                        }}>
                                            {fullName}
                                            {fullName && user.email ? ' · ' : ''}
                                            {user.email}
                                        </div>
                                    )}
                                </div>
                            </Flex>
                        );
                    },
                },
                ...(isInternalAdmin ? [{
                    key: 'organization',
                    title: t.organization,
                    dataIndex: 'organization',
                    render: orgId => organizations[orgId] || <span style={{opacity: 0.4}}>N/A</span>
                }] : []),
                {
                    key: 'role',
                    title: t.role,
                    dataIndex: 'role',
                    render: role => (
                        <Tag color={roleColors[role]} style={{fontWeight: 500}}>
                            {roleLabels[role] || role}
                        </Tag>
                    )
                },
                {
                    key: 'status',
                    title: t.userStatus,
                    dataIndex: 'is_active',
                    align: 'center',
                    render: (_, user) => {
                        const isSelf = user.id === authData?.user?.id;
                        const tag = (
                            <Tag
                                color={user.is_active ? 'success' : 'default'}
                                style={{
                                    margin: 0,
                                    fontWeight: 500,
                                    cursor: isSelf ? 'not-allowed' : 'pointer',
                                    opacity: statusBusyId === user.id ? 0.5 : 1,
                                    userSelect: 'none',
                                }}
                            >
                                {user.is_active ? t.userActive : t.userDisabled}
                            </Tag>
                        );
                        if (isSelf) {
                            return <Tooltip title={t.cannotDeleteSelf}>{tag}</Tooltip>;
                        }
                        return (
                            <Popconfirm
                                title={user.is_active
                                    ? `${t.deactivate} ${user.username}?`
                                    : `${t.activate} ${user.username}?`}
                                onConfirm={() => handleToggleActive(user)}
                                okText={t.yes}
                                cancelText={t.no}
                                okButtonProps={{danger: user.is_active}}
                            >
                                {tag}
                            </Popconfirm>
                        );
                    },
                },
                {
                    key: 'ip_enabled',
                    title: t.ipEnabled,
                    dataIndex: 'allowed_ips',
                    align: 'center',
                    render: allowed_ips => (allowed_ips && allowed_ips.length > 0)
                        ? <CheckOutlined style={{color: '#52c41a', fontSize: 16}}/>
                        : <CloseOutlined style={{color: '#ff4d4f', fontSize: 14, opacity: 0.5}}/>
                }
            ]} AddModal={AddUserModal} handleAdd={handleAdd} addModalExtraProps={addModalExtraProps}
                     EditModal={EditUserModal} handleEdit={handleEdit} handleDelete={handleDelete}
                     locale={{
                         emptyText: renderEmpty(),
                     }}/>
        </>
    );
};

export default UsersTab;

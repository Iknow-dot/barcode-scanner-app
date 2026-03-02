import React, {useContext, useEffect, useRef, useState} from 'react';
import {userService, organizationService} from '../../api';
import {Tag, Input, Select, Row, Col, Button} from "antd";
import DataTab from "../DataTab";
import AuthContext from "../Auth/AuthContext";
import AddUserModal from "../User/AddUserModal";
import EditUserModal from "../User/EditUser";
import {CheckOutlined, CloseOutlined} from "@ant-design/icons";
import useAppNotification from "../../hooks/useAppNotification";
import {useLanguage} from '../../i18n/LanguageContext';

const roleColors = {
    internal_admin: "red",
    company_admin: "green",
    company_user: "geekblue"
};

const UsersTab = ({initialUsers, addModalExtraProps, handleEditCallback = null, filtersEnabled = false}) => {
    const {authData} = useContext(AuthContext);
    const {notify, contextHolder} = useAppNotification();
    const {t} = useLanguage();
    const [users, setUsers] = useState(initialUsers || []);
    const [organizations, setOrganizations] = useState({});
    const [orgOptions, setOrgOptions] = useState([]);
    const [query, setQuery] = useState('');
    const [selectedOrg, setSelectedOrg] = useState(null);
    const [selectedRole, setSelectedRole] = useState(null);

    const roleOptions = Object.keys(roleColors).map(r => ({value: r, label: r}));

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
        if (authData?.role === 'internal_admin') {
            fetchOrganizations();
        }
    }, [authData]);

    useEffect(() => setUsers(initialUsers || []), [initialUsers]);

    const fetchUsers = async (params = {}) => {
        const result = await userService.getUsers(params);
        if (result.success) {
            setUsers(result.data);
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

    const handleAdd = async (newUser) => {
        const payload = {
            username: newUser.username,
            password: newUser.password,
            role: newUser.role || 'company_user',
            email: newUser.email || '',
            first_name: newUser.first_name || '',
            last_name: newUser.last_name || '',
        };

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
            // Use the API response data which has the correct format
            // (allowed_ips as objects, warehouse_ids_read, etc.)
            const updatedUser = result.data;
            setUsers(prev => prev.map(u => u.id === editUser.id ? updatedUser : u));
            notify.success(t.success, t.userUpdated(editUser.username));
            if (handleEditCallback) handleEditCallback(updatedUser, modifiedFields, editUser);
            return true;
        }

        notify.error(t.error, result.error);
        return false;
    };

    return (
        <>
            {contextHolder}
            <div style={{marginBottom: 16}}>
                {authData?.role === 'internal_admin' && filtersEnabled && (
                    <Row gutter={8} align="middle">
                        <Col>
                            <Input.Search
                                placeholder={t.filterName}
                                allowClear
                                onSearch={(v) => {
                                    if (debounceTimer.current) clearTimeout(debounceTimer.current);
                                    setQuery(v);
                                    handleSearch();
                                }}
                                onChange={e => handleQueryChange(e.target.value)}
                                style={{width: 300}}
                            />
                        </Col>
                        <Col>
                            <Select
                                showSearch
                                placeholder={t.filterOrganization}
                                options={orgOptions}
                                onChange={handleOrgChange}
                                allowClear
                                style={{width: 240}}
                            />
                        </Col>
                        <Col>
                            <Select
                                showSearch
                                placeholder={t.filterRole}
                                options={roleOptions}
                                onChange={handleRoleChange}
                                allowClear
                                style={{width: 200}}
                            />
                        </Col>
                        <Col>
                            <Button type="primary" onClick={() => {
                                if (debounceTimer.current) clearTimeout(debounceTimer.current);
                                handleSearch();
                            }}>{t.search}</Button>
                            <Button style={{marginLeft: 8}} onClick={() => {
                                setQuery('');
                                setSelectedOrg(null);
                                setSelectedRole(null);
                                fetchUsers();
                            }}>{t.clear}</Button>
                        </Col>
                    </Row>
                )}
            </div>

            <DataTab objects={users} columns={[
                {key: 'username', title: t.name, dataIndex: 'username'},
                {
                    key: 'organization',
                    title: t.organization,
                    dataIndex: 'organization',
                    render: orgId => organizations[orgId] || 'N/A'
                },
                {
                    key: 'role',
                    title: t.role,
                    dataIndex: 'role',
                    render: role => <Tag color={roleColors[role]}>{role}</Tag>
                },
                {
                    key: 'ip_enabled',
                    title: t.ipEnabled,
                    dataIndex: 'allowed_ips',
                    render: allowed_ips => (allowed_ips && allowed_ips.length > 0) ? <CheckOutlined style={{color: 'green'}}/> :
                        <CloseOutlined style={{color: 'red'}}/>
                }
            ]} AddModal={AddUserModal} handleAdd={handleAdd} addModalExtraProps={addModalExtraProps}
                     EditModal={EditUserModal} handleEdit={handleEdit} handleDelete={handleDelete}/>
        </>
    );
};

export default UsersTab;

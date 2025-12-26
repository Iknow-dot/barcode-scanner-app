import React, {useContext, useEffect, useRef, useState} from 'react';
import api from '../../api';
import {notification, Tag, Input, Select, Row, Col, Button} from "antd";
import DataTab from "../DataTab";
import AuthContext from "../Auth/AuthContext";
import AddUserModal from "../User/AddUserModal";
import EditUserModal from "../User/EditUser";
import {CheckOutlined, CloseCircleOutlined, CloseOutlined} from "@ant-design/icons";

const roleColors = {
    system_admin: "red",
    admin: "green",
    user: "geekblue"
}

const UsersTab = ({initialUsers, addModalExtraProps, handleEditCallback = null, filtersEnabled = false}) => {
    const {authData} = useContext(AuthContext);
    const [users, setUsers] = useState(initialUsers || []);
    const [organizations, setOrganizations] = useState({});
    const [orgOptions, setOrgOptions] = useState([]);
    const [notificationApi, contextHolder] = notification.useNotification();
    const [notificationData, setNotificationData] = useState({});
    const [query, setQuery] = useState('');
    const [selectedOrg, setSelectedOrg] = useState(null);
    const [selectedRole, setSelectedRole] = useState(null);

    const roleOptions = Object.keys(roleColors).map(r => ({value: r, label: r}));

    // debounce timer ref
    const debounceTimer = useRef(null);
    const DEBOUNCE_MS = 300;

    useEffect(() => {
        const fetchOrganizations = async () => {
            try {
                const response = await api.get('/organizations');
                const orgMap = response.data.reduce((acc, org) => {
                    acc[org.id] = org.name;
                    return acc;
                }, {});
                setOrganizations(orgMap);
                setOrgOptions(response.data.map(org => ({value: org.id, label: org.name})));
            } catch (error) {
                console.error('Error fetching organizations:', error);
            }
        };
        fetchOrganizations();
    }, []);

    useEffect(() => setUsers(initialUsers || []), [initialUsers]);

    useEffect(() => {
        if (notificationData.message) {
            notificationApi[notificationData.type]({
                message: notificationData.message,
                description: notificationData.description
            });
        }
    }, [notificationData, notificationApi]);

    const fetchUsers = async (params = {}) => {
        try {
            const res = await api.get('/users', {params});
            setUsers(res.data);
        } catch (e) {
            console.error('Error fetching users', e);
        }
    };

    // immediate search trigger
    const handleSearch = () => {
        const params = {};
        if (query && query.trim() !== '') params.q = query.trim();
        if (selectedOrg) params.organization_id = selectedOrg;
        if (selectedRole) params.role = selectedRole;
        fetchUsers(params);
    };

    // debounced handler for input changes
    const handleQueryChange = (value) => {
        setQuery(value);
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => {
            const params = {};
            if (value && value.trim() !== '') params.q = value.trim();
            if (selectedOrg) params.organization_id = selectedOrg;
            if (selectedRole) params.role = selectedRole;
            fetchUsers(params);
        }, DEBOUNCE_MS);
    };

    // selection changes should trigger immediate search
    const handleOrgChange = (value) => {
        setSelectedOrg(value);
        const params = {};
        if (query && query.trim() !== '') params.q = query.trim();
        if (value) params.organization_id = value;
        if (selectedRole) params.role = selectedRole;
        fetchUsers(params);
    };

    const handleRoleChange = (value) => {
        setSelectedRole(value);
        const params = {};
        if (query && query.trim() !== '') params.q = query.trim();
        if (selectedOrg) params.organization_id = selectedOrg;
        if (value) params.role = value;
        fetchUsers(params);
    };

    const handleAdd = async (newUser) => {
        if (authData?.role === 'admin') {
            newUser.organization_id = authData.organization_id;
            newUser.role_name = 'user';
        }
        try {
            if (newUser.ip_address) newUser.ip_address = newUser.ip_address.join(', ');
            const resp = await api.post('/users', newUser, {headers: {'Content-Type': 'application/json'}});
            if (resp.status === 201) {
                newUser.id = resp.data.id;
                setUsers(prev => [...prev, newUser]);
                setNotificationData({
                    type: 'success',
                    message: 'წარმატება',
                    description: `მომხმარებელი "${newUser.username}" წარმატებით შეიქმნა`
                });
                return true;
            }
        } catch (err) {

            const message = err.response?.data?.error || err.message;

            if (message.includes('User limit')) {
                setNotificationData({
                    type: 'error',
                    message: 'შეცდომა',
                    description: "მომხმარებელთა ლიმიტი მიღწეულია. გთხოვთ, დაუკავშირდით ადმინისტრატორს დამატებითი ინფორმაციისთვის.",
                });
            } else {
                setNotificationData({
                    type: 'error',
                    message: 'შეცდომა',
                    description: err.response?.data?.error || err.message
                });
            }
            return false;
        }
    };

    const handleDelete = async (deleteUser) => {
        if (deleteUser.id === authData.user.id) {
            setNotificationData({
                type: 'error',
                message: 'შეცდომა',
                description: 'თქვენ არ შეგიძლიათ თქვენი საკუთარი ანგარიშის წაშლა.'
            });
            return false;
        }
        try {
            await api.delete(`/users/${deleteUser.id}`);
            setUsers(prev => prev.filter(u => u.id !== deleteUser.id));
            setNotificationData({
                type: 'success',
                message: 'წარმატება',
                description: `${deleteUser.username} წარმატებით წაიშალა`
            });
        } catch (err) {
            setNotificationData({
                type: 'error',
                message: 'შეცდომა',
                description: err.response?.data?.error || err.message
            });
        }
    };

    const handleEdit = async (modifiedFields, editUser) => {
        try {
            const payload = {...editUser, ...modifiedFields};
            if (payload.ip_address && Array.isArray(payload.ip_address)) payload.ip_address = payload.ip_address.join(', ');
            await api.put(`/users/${editUser.id}`, payload);
            setUsers(prev => prev.map(u => u.id === editUser.id ? payload : u));
            setNotificationData({
                type: 'success',
                message: 'წარმატება',
                description: `მომხმარებელი "${editUser.username}" წარმატებით განახლდა`
            });
            if (handleEditCallback) handleEditCallback(payload);
            return true;
        } catch (err) {
            setNotificationData({
                type: 'error',
                message: 'შეცდომა',
                description: err.response?.data?.error || err.message
            });
            return false;
        }
    };

    return (
        <>
            {contextHolder}
            <div style={{marginBottom: 16}}>
                {authData?.role === 'system_admin' && filtersEnabled && (
                    <Row gutter={8} align="middle">
                        <Col>
                            <Input.Search
                                placeholder="სახელი"
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
                                placeholder="ორგანიზაცია"
                                options={orgOptions}
                                onChange={handleOrgChange}
                                allowClear
                                style={{width: 240}}
                            />
                        </Col>
                        <Col>
                            <Select
                                showSearch
                                placeholder="როლი"
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
                            }}>ძებნა</Button>
                            <Button style={{marginLeft: 8}} onClick={() => {
                                setQuery('');
                                setSelectedOrg(null);
                                setSelectedRole(null);
                                fetchUsers();
                            }}>გასუფთავება</Button>
                        </Col>
                    </Row>
                )}
            </div>

            <DataTab objects={users} columns={[
                {key: 'username', title: 'სახელი', dataIndex: 'username'},
                {
                    key: 'organization_id',
                    title: 'ორგანიზაცია',
                    dataIndex: 'organization_id',
                    render: orgId => organizations[orgId] || 'N/A'
                },
                {
                    key: 'role_name',
                    title: 'როლი',
                    dataIndex: 'role_name',
                    render: role => <Tag color={roleColors[role]}>{role}</Tag>
                },
                {
                    key: 'ip_address',
                    title: 'IP Enabled',
                    dataIndex: 'ip_address',
                    render: ip => ip ? <CheckOutlined style={{color: 'green'}}/> :
                        <CloseOutlined style={{color: 'red'}}/>
                }
            ]} AddModal={AddUserModal} handleAdd={handleAdd} addModalExtraProps={addModalExtraProps}
                     EditModal={EditUserModal} handleEdit={handleEdit} handleDelete={handleDelete}/>
        </>
    );
};

export default UsersTab;

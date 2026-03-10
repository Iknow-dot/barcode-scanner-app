import React, {useState, useEffect, useContext} from 'react';
import {userService, userRoles} from '../../api';
import AuthContext from '../Auth/AuthContext';
import OrganizationsTab from './OrganizationsTab';
import WarehousesTab from './WarehousesTab';
import UsersTab from './UsersTab';
import ExternalServiceSettings from '../Organization/ExternalServiceSettings';
import {AppstoreOutlined, BankOutlined, GlobalOutlined, UserOutlined} from "@ant-design/icons";
import SubNavContext from "../../contexts/SubNavContext";
import {useLanguage} from '../../i18n/LanguageContext';
import {Typography} from "antd";

const {Title, Text} = Typography;

const tabMeta = (t) => ({
    1: {title: t.organizations, subtitle: t.orgTabSubtitle || '', icon: <BankOutlined style={{color: '#1677ff', fontSize: 22}}/>},
    2: {title: t.warehouses, subtitle: t.warehouseTabSubtitle || '', icon: <AppstoreOutlined style={{color: '#1677ff', fontSize: 22}}/>},
    3: {title: t.users, subtitle: t.userTabSubtitle || '', icon: <UserOutlined style={{color: '#1677ff', fontSize: 22}}/>},
    4: {title: t.externalServiceSettings, subtitle: t.externalServiceSubtitle || '', icon: <GlobalOutlined style={{color: '#1677ff', fontSize: 22}}/>},
});

const SystemAdminDashboard = () => {
    const {setSubNav} = useContext(SubNavContext);
    const {authData} = useContext(AuthContext);
    const [users, setUsers] = useState([]);
    const [usersLoading, setUsersLoading] = useState(true);
    const userRole = authData?.role;
    const [activeTab, setActiveTab] = useState(userRole === userRoles.internal_admin ? 1 : 2);
    const {t} = useLanguage();

    useEffect(() => {
        setSubNav([
            userRole === userRoles.internal_admin && ({
                key: '1',
                icon: <BankOutlined/>,
                label: t.organizations,
                onClick: () => setActiveTab(1)
            }),
            userRole === userRoles.company_admin && ({
                key: '2',
                icon: <AppstoreOutlined/>,
                label: t.warehouses,
                onClick: () => setActiveTab(2)
            }),
            {
                key: '3',
                active: "true",
                icon: <UserOutlined/>,
                label: t.users,
                onClick: () => setActiveTab(3)
            },
            userRole === userRoles.company_admin && ({
                key: '4',
                icon: <GlobalOutlined/>,
                label: t.externalServiceSettings,
                onClick: () => setActiveTab(4)
            }),
        ].filter(Boolean));
    }, [userRole, setSubNav, t]);

    const fetchUsers = async () => {
        setUsersLoading(true);
        try {
            const result = await userService.getUsers();
            if (result.success) {
                const data = result.data;
                setUsers(Array.isArray(data) ? data : data.results || []);
            } else {
                console.error(t.dataFetchError, result.error);
            }
        } finally {
            setUsersLoading(false);
        }
    };

    // Fetch users on mount and whenever the Users tab becomes active
    useEffect(() => {
        fetchUsers();
    }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

    const meta = tabMeta(t)[activeTab];

    let ActiveTabPane = null;
    switch (activeTab) {
        case 1:
            ActiveTabPane = <OrganizationsTab/>;
            break;
        case 2:
            ActiveTabPane = <WarehousesTab/>;
            break;
        case 3:
            ActiveTabPane = <UsersTab initialUsers={users} initialLoading={usersLoading} filtersEnabled={true}/>;
            break;
        case 4:
            ActiveTabPane = <ExternalServiceSettings/>;
            break;
        default:
            ActiveTabPane = null;
    }

    return (
        <>
            {meta && (
                <div className="page-header">
                    <Title level={4} style={{margin: 0, display: 'flex', alignItems: 'center', gap: 10}}>
                        {meta.icon}
                        {meta.title}
                    </Title>
                    {meta.subtitle && (
                        <Text type="secondary" style={{fontSize: 13, marginTop: 2, display: 'block'}}>
                            {meta.subtitle}
                        </Text>
                    )}
                </div>
            )}
            {ActiveTabPane}
        </>
    );
};

export default SystemAdminDashboard;

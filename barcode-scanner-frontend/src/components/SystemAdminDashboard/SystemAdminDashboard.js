import React, {useState, useEffect, useContext} from 'react';
import {userService, userRoles} from '../../api';
import AuthContext from '../Auth/AuthContext';
import OrganizationsTab from './OrganizationsTab';
import WarehousesTab from './WarehousesTab';
import UsersTab from './UsersTab';
import {AppstoreOutlined, BankOutlined, UserOutlined} from "@ant-design/icons";
import SubNavContext from "../../contexts/SubNavContext";
import {useLanguage} from '../../i18n/LanguageContext';


const SystemAdminDashboard = () => {
    const {setSubNav} = useContext(SubNavContext);
    const {authData} = useContext(AuthContext);
    const [users, setUsers] = useState([]);
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
            }
        ].filter(Boolean));
    }, [userRole, setSubNav, t]);

    useEffect(() => {
        const fetchData = async () => {
            const result = await userService.getUsers();
            if (result.success) {
                const data = result.data;
                setUsers(Array.isArray(data) ? data : data.results || []);
            } else {
                console.error(t.dataFetchError, result.error);
            }
        };
        fetchData();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    let ActiveTabPane = null;
    switch (activeTab) {
        case 1:
            ActiveTabPane = <OrganizationsTab/>;
            break;
        case 2:
            ActiveTabPane = <WarehousesTab/>;
            break;
        case 3:
            ActiveTabPane = <UsersTab initialUsers={users} filtersEnabled={true}/>;
            break;
        default:
            ActiveTabPane = null;
    }

    return (
        <>
            {ActiveTabPane}
        </>
    );
};

export default SystemAdminDashboard;

import React, {useState, useEffect, useContext} from 'react';
import api from '../../api';
import AuthContext from '../Auth/AuthContext';
import OrganizationsTab from './OrganizationsTab';
import WarehousesTab from './WarehousesTab';
import UsersTab from './UsersTab';
import AddUserModal from '../User/AddUserModal';
import EditUser from '../User/EditUser';
import {AppstoreOutlined, BankOutlined, UserOutlined} from "@ant-design/icons";
import SubNavContext from "../../contexts/SubNavContext";


const SystemAdminDashboard = () => {
  const {setSubNav} = useContext(SubNavContext);
  const {authData} = useContext(AuthContext);
  const [users, setUsers] = useState([]);
  const userRole = authData?.role;
  const [activeTab, setActiveTab] = useState(userRole === 'system_admin' ? 1 : 2);


  useEffect(() => {
    setSubNav([
      userRole === 'system_admin' && ({
        key: '1',
        icon: <BankOutlined/>,
        label: "ორგანიზაციები",
        onClick: () => setActiveTab(1)
      }),
      userRole === 'admin' && ({
        key: '2',
        icon: <AppstoreOutlined/>,
        label: "საწყობები",
        onClick: () => setActiveTab(2)
      }),
      {
        key: '3',
        active: "true",
        icon: <UserOutlined/>,
        label: "მომხმარებლები",
        onClick: () => setActiveTab(3)
      }
    ]);
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const userRes = await api.get('/users');
        setUsers(userRes.data);
      } catch (error) {
        console.error('შეცდომა მონაცემების მიღებისას', error);
      }
    };
    fetchData();
  }, []);


  let ActiveTabPane = null;
  switch (activeTab) {
    case 1:
      ActiveTabPane = (
          <OrganizationsTab/>
      );
      break;
    case 2:
      ActiveTabPane = (
          <WarehousesTab/>
      );
      break;
    case 3:
      ActiveTabPane = (
          <UsersTab
              initialUsers={users}
          />
      );
      break;
  }

  return (
      <>
        {ActiveTabPane}
      </>
  );
};

export default SystemAdminDashboard;
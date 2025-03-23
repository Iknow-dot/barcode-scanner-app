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
  const [organizations, setOrganizations] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [users, setUsers] = useState([]);
  const [activeTab, setActiveTab] = useState(authData.role === 'system_admin' ? 1 : 2);
  const [editWarehouseData, setEditWarehouseData] = useState(null);

  const userRole = authData?.role;

  useEffect(() => {
    setSubNav([
      userRole === 'system_admin' && ({
        key: '1',
        icon: <BankOutlined/>,
        label: "ორგანიზაციები",
        onClick: () => setActiveTab(1)
      }),
      {
        key: '2',
        icon: <AppstoreOutlined/>,
        label: "საწყობები",
        onClick: () => setActiveTab(2)
      },
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
        const [orgRes, whRes, userRes] = await Promise.all([
          api.get('/organizations'),
          api.get('/warehouses'),
          api.get('/users')
        ]);
        setOrganizations(orgRes.data);
        setWarehouses(whRes.data);
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
              users={users}
              AddModal={AddUserModal}
              addModalExtraProps={{
                userRole,
                organizations,
                warehouses
              }}
              EditModal={EditUser}
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
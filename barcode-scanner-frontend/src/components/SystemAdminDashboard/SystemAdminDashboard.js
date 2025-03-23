import React, {useState, useEffect, useContext} from 'react';
import api from '../../api';
import AuthContext from '../Auth/AuthContext';
import OrganizationsTab from './OrganizationsTab';
import WarehousesTab from './WarehousesTab';
import UsersTab from './UsersTab';
import AddOrganization from '../Organization/AddOrganization';
import EditOrganization from '../Organization/EditOrganization';
import AddUserModal from '../User/AddUserModal';
import EditUser from '../User/EditUser';
import AddWarehouse from '../Warehouse/AddWarehouse';
import EditWarehouse from '../Warehouse/EditWarehouse';
import {Tabs} from "antd";
import {AppstoreOutlined, BankOutlined, UserOutlined} from "@ant-design/icons";
import SubNavContext from "../../contexts/SubNavContext";


const SystemAdminDashboard = () => {
  const {setSubNav} = useContext(SubNavContext);
  const {authData, logout} = useContext(AuthContext);
  const [organizations, setOrganizations] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [users, setUsers] = useState([]);
  const [activeTab, setActiveTab] = useState(3);
  const [isModalOpen, setModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState('');
  const [darkMode, setDarkMode] = useState(localStorage.getItem('darkMode') === 'true');
  const [editOrgData, setEditOrgData] = useState(null);
  const [editWarehouseData, setEditWarehouseData] = useState(null);
  const [editUserData, setEditUserData] = useState({});

  const userRole = authData?.role;
  const userOrganizationId = authData?.organization_id;

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

  const openModal = (contentType, orgData = null, warehouseData = null, userData = null) => {
    setModalContent(contentType);
    setModalOpen(true);

    // Set the appropriate data based on contentType
    if (contentType === 'edit') {
      setEditOrgData(orgData);
      setEditWarehouseData(null);
      setEditUserData(null);
    } else if (contentType === 'editWarehouse') {
      setEditWarehouseData(warehouseData);
      setEditOrgData(null);
      setEditUserData(null);
    } else if (contentType === 'editUser') {
      setEditUserData(userData);
      setEditOrgData(null);
      setEditWarehouseData(null);
    } else {
      setEditOrgData(null);
      setEditWarehouseData(null);
      setEditUserData(null);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditOrgData(null);
  };

  const handleEditOrganization = async (updatedOrgData) => {
    try {
      if (editOrgData) {
        await api.put(`/organizations/${editOrgData.id}`, updatedOrgData);
        const orgRes = await api.get('/organizations');
        setOrganizations(orgRes.data);
      }
      closeModal();
    } catch (error) {
      console.error('ორგანიზაციის დამატების შეცდომა', error);
    }
  };

  const handleEditWarehouse = async (updatedWarehouseData) => {
    try {
      if (editWarehouseData) {
        await api.put(`/warehouses/${editWarehouseData.id}`, updatedWarehouseData);
        const WarehouseRes = await api.get('/warehouses');
        setEditWarehouseData(WarehouseRes.data);
      }
      closeModal();
    } catch (error) {
      console.error('საწყობის განახლების შეცდომა', error);
    }
  };

  const handleAddWarehouse = async (newWarehouseData) => {
    try {
      await api.post('/warehouses', newWarehouseData);
      const whRes = await api.get('/warehouses');
      setWarehouses(whRes.data);
      closeModal();
    } catch (error) {
      console.error('საწყობის დამატების შეცდომა', error);
    }
  };
  let ActiveTabPane = null;
  switch (activeTab) {
    case 1:
      ActiveTabPane = (
          <OrganizationsTab />
      );
      break;
    case 2:
      ActiveTabPane = (
          <WarehousesTab
              warehouses={warehouses}
              openModal={(mode, wh) => openModal(mode, null, wh)}
              isModalOpen={isModalOpen}
          />
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
        {isModalOpen && (
            <div className="modal active">
              {modalContent === 'editWarehouse' && editWarehouseData ? (
                  <EditWarehouse
                      warehouseData={editWarehouseData} // Change 'warehouseDataData' to 'warehouseData'
                      handleEditWarehouse={handleEditWarehouse}
                      closeModal={closeModal}
                  />
              ) : (
                  <AddWarehouse
                      handleAddWarehouse={handleAddWarehouse}
                      closeModal={closeModal}
                      organizationId={userOrganizationId}
                  />
              )}
            </div>
        )}
      </>
  );
};

export default SystemAdminDashboard;
import React, {useState, useEffect, useContext} from 'react';
import './SystemAdminDashboard.css';
import api from '../../api';
import AuthContext from '../Auth/AuthContext';
import OrganizationsTab from './OrganizationsTab';
import WarehousesTab from './WarehousesTab';
import UsersTab from './UsersTab';
import AddOrganization from '../Organization/AddOrganization';
import EditOrganization from '../Organization/EditOrganization';
import AddUser from '../User/AddUser';
import EditUser from '../User/EditUser';
import AddWarehouse from '../Warehouse/AddWarehouse';
import EditWarehouse from '../Warehouse/EditWarehouse';
import {Tabs} from "antd";
import {AppstoreOutlined, BankOutlined, UserOutlined} from "@ant-design/icons";


const SystemAdminDashboard = () => {
  const {authData, logout} = useContext(AuthContext);
  const [organizations, setOrganizations] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [users, setUsers] = useState([]);
  const [activeTab, setActiveTab] = useState('Users');
  const [isModalOpen, setModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState('');
  const [darkMode, setDarkMode] = useState(localStorage.getItem('darkMode') === 'true');
  const [editOrgData, setEditOrgData] = useState(null);
  const [editWarehouseData, setEditWarehouseData] = useState(null);
  const [editUserData, setEditUserData] = useState(null);

  const userRole = authData?.role;
  const userOrganizationId = authData?.organization_id;

  const tabItems = [
    userRole === 'system_admin' && ({
      key: "1",
      label: (
          <>
            <BankOutlined/> ორგანიზაციები
          </>
      ),
      children: (
          <OrganizationsTab
              organizations={organizations}
              openModal={(mode, org) => openModal(mode, org)}
              handleEdit={(org) => openModal('edit', org)}
          />
      )
    }),
    userRole === 'admin' && ({
      key: "2",
      label: (
          <>
            <AppstoreOutlined/> საწყობები
          </>
      ),
      children: (
          <WarehousesTab
              warehouses={warehouses}
              openModal={(mode, wh) => openModal(mode, null, wh)}
          />
      )
    }),
    {
      key: "3",
      label: <><UserOutlined/> მომხმარებლები</>,
      children: (
          <UsersTab
              users={users}
              openModal={(mode, User) => openModal(mode, null, null, User)}
          />
      )
    }
  ];

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

  const toggleDarkMode = () => {
    const isDarkMode = !darkMode;
    setDarkMode(isDarkMode);
    localStorage.setItem('darkMode', isDarkMode);
    document.body.classList.toggle('dark-mode', isDarkMode);
  };

  const openTab = (tabName) => setActiveTab(tabName);

  // const openModal = (contentType, orgData = null, warehouseData = null) => {
  //   setModalContent(contentType);
  //   setModalOpen(true);
  //   setEditOrgData(contentType === 'edit' ? orgData : null);
  // };


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

  const handleAddOrganization = async (newOrgData) => {
    try {
      await api.post('/organizations', newOrgData);
      const orgRes = await api.get('/organizations');
      setOrganizations(orgRes.data);
      closeModal();
    } catch (error) {
      console.error('ორგანიზაციის შექმნის შეცდომა', error);
    }
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

  const handleEditUser = async (updatedUserData) => {
    try {
      if (editUserData) {
        await api.put(`/users/${editUserData.id}`, updatedUserData);
        const UserRes = await api.get('/users');
        setEditUserData(UserRes.data);
      }
      closeModal();
    } catch (error) {
      console.error('მომხმარებლის განახლების შეცდომა', error);
    }
  };

  const handleAddUser = async (newUserData) => {
    try {
      await api.post('/users', newUserData);
      const userRes = await api.get('/users');
      setUsers(userRes.data);
      closeModal();
    } catch (error) {
      console.error('მომხმარებლის დამატების შეცდომა', error);
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

  return (
      <>

        <div className="container">
          <div className="header-line">
            <img
                src="https://imgur.com/VV5PiDB.png"
                alt="Logo"
                style={{backgroundColor: 'rgba(159, 159, 159)'}}
                width="150"
            />
            <button onClick={logout} className="logout-btn">გასვლა</button>
          </div>
          <div className="dashboard-container">
            <div className="header">
              <h2>Dark Mode</h2>
              <label className="switch">
                <input type="checkbox" checked={darkMode} onChange={toggleDarkMode}/>
                <span className="slider round"></span>
              </label>
            </div>
            <Tabs defaultActiveKey="1" items={tabItems}/>

            {isModalOpen && (
                <div className="modal active">
                  {modalContent === 'edit' && editOrgData ? (
                      <EditOrganization
                          organizationData={editOrgData}
                          handleEditOrganization={handleEditOrganization}
                          closeModal={closeModal}
                      />
                  ) : modalContent === 'editWarehouse' && editWarehouseData ? (
                      <EditWarehouse
                          warehouseData={editWarehouseData} // Change 'warehouseDataData' to 'warehouseData'
                          handleEditWarehouse={handleEditWarehouse}
                          closeModal={closeModal}
                      />
                  ) : modalContent === 'editUser' && editUserData ? (
                      <EditUser
                          userData={editUserData} // Change 'userDataData' to 'warehouseData'
                          handleEditUser={handleEditUser}
                          closeModal={closeModal}
                      />
                  ) : modalContent === 'organization' ? (
                      <AddOrganization
                          handleAddOrganization={handleAddOrganization}
                          closeModal={closeModal}
                      />
                  ) : modalContent === 'user' ? (
                      <AddUser
                          handleAddUser={handleAddUser}
                          closeModal={closeModal}
                          isModalOpen={isModalOpen}
                          userRole={userRole}
                          organizations={organizations}
                          warehouses={warehouses}
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
          </div>
        </div>
      </>
  );
};

export default SystemAdminDashboard;
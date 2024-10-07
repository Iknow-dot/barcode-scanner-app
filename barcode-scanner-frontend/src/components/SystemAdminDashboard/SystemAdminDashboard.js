import React, { useState, useEffect, useContext } from 'react';
import './SystemAdminDashboard.css';
import api from '../../api';
import AuthContext from '../Auth/AuthContext';
import OrganizationsTab from './OrganizationsTab';
import WarehousesTab from './WarehousesTab';
import UsersTab from './UsersTab';
import AddOrganization from '../Organization/AddOrganization';
import EditOrganization from '../Organization/EditOrganization';
import AddUser from '../User/AddUser';
import AddWarehouse from '../Warehouse/AddWarehouse';

const SystemAdminDashboard = () => {
  const { authData, logout } = useContext(AuthContext);
  const [organizations, setOrganizations] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [users, setUsers] = useState([]);
  const [activeTab, setActiveTab] = useState('Users');
  const [isModalOpen, setModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState('');
  const [darkMode, setDarkMode] = useState(localStorage.getItem('darkMode') === 'true');
  const [editOrgData, setEditOrgData] = useState(null);

  const userRole = authData?.role;
  const userOrganizationId = authData?.organization_id;

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
        console.error('Error fetching data', error);
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

  const openModal = (contentType, orgData = null) => {
    setModalContent(contentType);
    setModalOpen(true);
    setEditOrgData(contentType === 'edit' ? orgData : null);
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
      console.error('Error adding organization', error);
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
      console.error('Error editing organization', error);
    }
  };

  const handleAddUser = async (newUserData) => {
    try {
      await api.post('/users', newUserData);
      const userRes = await api.get('/users');
      setUsers(userRes.data);
      closeModal();
    } catch (error) {
      console.error('Error adding user', error);
    }
  };

  const handleAddWarehouse = async (newWarehouseData) => {
    try {
      await api.post('/warehouses', newWarehouseData);
      const whRes = await api.get('/warehouses');
      setWarehouses(whRes.data);
      closeModal();
    } catch (error) {
      console.error('Error adding warehouse', error);
    }
  };

  return (
    <div className="container">
      <div className="header-line">
        <img
          src="http://iknow.ge/wp-content/uploads/2022/10/sliderlogo.png"
          alt="Logo"
          style={{ backgroundColor: 'rgba(159, 159, 159)' }}
          width="150"
        />
        <button onClick={logout} className="logout-btn">გასვლა</button>
      </div>
      <div className="dashboard-container">
        <div className="header">
          <h2>Dark Mode</h2>
          <label className="switch">
            <input type="checkbox" checked={darkMode} onChange={toggleDarkMode} />
            <span className="slider round"></span>
          </label>
        </div>

        <div className="tabs">
          {userRole === 'system_admin' && (
            <button
              className={`tab-link ${activeTab === 'Organizations' ? 'active' : ''}`}
              onClick={() => openTab('Organizations')}
            >
              ორგანიზაციები
            </button>
          )}

          {userRole === 'admin' && (
            <button
              className={`tab-link ${activeTab === 'Warehouses' ? 'active' : ''}`}
              onClick={() => openTab('Warehouses')}
            >
              საწყობები
            </button>
          )}

          <button
            className={`tab-link ${activeTab === 'Users' ? 'active' : ''}`}
            onClick={() => openTab('Users')}
          >
            მომხმარებლები
          </button>
        </div>

        {userRole === 'system_admin' && activeTab === 'Organizations' && (
          <OrganizationsTab
            organizations={organizations}
            openModal={(mode, org) => openModal(mode, org)}
            handleEdit={(org) => openModal('edit', org)}
          />
        )}

        {userRole === 'admin' && activeTab === 'Warehouses' && (
          <WarehousesTab
            warehouses={warehouses}
            openModal={(mode) => openModal(mode)}
          />
        )}

        {activeTab === 'Users' && (
          <UsersTab
            users={users}
            openModal={(mode) => openModal(mode)}
          />
        )}

        {isModalOpen && (
          <div className="modal active">
            {modalContent === 'edit' && editOrgData ? (
              <EditOrganization
                organizationData={editOrgData}
                handleEditOrganization={handleEditOrganization}
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
  );
};

export default SystemAdminDashboard;

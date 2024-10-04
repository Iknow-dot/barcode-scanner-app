import React, { useState, useEffect, useContext } from 'react';
import './SystemAdminDashboard.css';
import api from '../../api';
import AuthContext from '../Auth/AuthContext';
import OrganizationsTab from './OrganizationsTab';
import WarehousesTab from './WarehousesTab';
import UsersTab from './UsersTab';
import AddOrganization from '../Organization/AddOrganization'; // Import the AddOrganization component
import AddUser from '../User/AddUser'; // Import the AddUser component
import AddWarehouse from '../Warehouse/AddWarehouse'; // Import the AddWarehouse component

const SystemAdminDashboard = () => {
  const { authData, logout } = useContext(AuthContext);
  const [organizations, setOrganizations] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [users, setUsers] = useState([]);
  const [activeTab, setActiveTab] = useState('Users');
  const [isModalOpen, setModalOpen] = useState(false); // Modal for adding organizations/users
  const [modalContent, setModalContent] = useState(''); // Modal content type
  const [darkMode, setDarkMode] = useState(localStorage.getItem('darkMode') === 'true');

  const userRole = authData?.role;
  const userOrganizationId = authData?.organization_id; // Assuming you pass organization_id from authData

  // Fetch data for organizations, warehouses, and users
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
    if (isDarkMode) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
  };

  const openTab = (tabName) => setActiveTab(tabName);

  const openModal = (contentType) => {
    setModalContent(contentType);
    setModalOpen(true);
  };

  const closeModal = () => setModalOpen(false);

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

        {/* Organizations Tab */}
        {userRole === 'system_admin' && activeTab === 'Organizations' && (
          <OrganizationsTab
            organizations={organizations}
            openModal={() => openModal('organization')}
          />
        )}

        {/* Warehouses Tab */}
        {userRole === 'admin' && activeTab === 'Warehouses' && (
          <WarehousesTab
            warehouses={warehouses}
            openModal={() => openModal('warehouse')}
          />
        )}

        {/* Users Tab */}
        {activeTab === 'Users' && (
          <UsersTab
            users={users}
            openModal={() => openModal('user')}  // Open the Add User modal
          />
        )}

        {/* Modal for adding organizations/users/warehouses */}
        {isModalOpen && (
          <div className="modal active">
            {modalContent === 'organization' && (
              <AddOrganization handleAddOrganization={handleAddOrganization} closeModal={closeModal} />
            )}
            {modalContent === 'user' && (
              <AddUser
                handleAddUser={handleAddUser}
                closeModal={closeModal}
                userRole={userRole}
                organizations={organizations}
                warehouses={warehouses}
              />
            )}
            {modalContent === 'warehouse' && (
              <AddWarehouse
                handleAddWarehouse={handleAddWarehouse}
                closeModal={closeModal}
                organizationId={userOrganizationId} // Automatically pass the admin's organization ID
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SystemAdminDashboard;

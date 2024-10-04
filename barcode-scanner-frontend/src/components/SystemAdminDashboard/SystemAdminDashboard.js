import React, { useState, useEffect, useContext } from 'react';
import './SystemAdminDashboard.css';
import api from '../../api';
import AuthContext from '../Auth/AuthContext';
import OrganizationsTab from './OrganizationsTab';
import WarehousesTab from './WarehousesTab';
import UsersTab from './UsersTab';
import AddOrganization from '../Organization/AddOrganization'; // Import the new AddOrganization component

const SystemAdminDashboard = () => {
  const { authData } = useContext(AuthContext);
  const [organizations, setOrganizations] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [users, setUsers] = useState([]);
  const [activeTab, setActiveTab] = useState('Users');
  const [isModalOpen, setModalOpen] = useState(false); // Modal for adding organizations
  const [darkMode, setDarkMode] = useState(localStorage.getItem('darkMode') === 'true');

  const userRole = authData?.role;

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

  const openModal = () => setModalOpen(true);
  const closeModal = () => setModalOpen(false);

  const handleAddOrganization = async (newOrgData) => {
    try {
      // Post new organization data to the API
      await api.post('/organizations', newOrgData);
      
      // Fetch updated organizations list after successful creation
      const orgRes = await api.get('/organizations');
      
      // Update the organizations state to reflect new data
      setOrganizations(orgRes.data);
      
      // Close the modal after organization is added
      closeModal();
    } catch (error) {
      console.error('Error adding organization', error);
    }
  };

  return (
    <div className="container">
      <img
        src="http://iknow.ge/wp-content/uploads/2022/10/sliderlogo.png"
        alt="Logo"
        style={{ backgroundColor: 'rgba(159, 159, 159)' }}
        width="150"
      />
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
            openModal={openModal}  // Pass the openModal function
          />
        )}

        {/* Warehouses Tab */}
        {userRole === 'admin' && activeTab === 'Warehouses' && (
          <WarehousesTab
            warehouses={warehouses}
          />
        )}

        {/* Users Tab */}
        {activeTab === 'Users' && (
          <UsersTab
            users={users}
          />
        )}

        {/* Modal for adding organizations */}
        {isModalOpen && (
          <div className="modal active">
            <AddOrganization handleAddOrganization={handleAddOrganization} closeModal={closeModal} />
          </div>
        )}
      </div>
    </div>
  );
};

export default SystemAdminDashboard;

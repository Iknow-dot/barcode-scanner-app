import React, { useState, useEffect, useContext } from 'react';
import './SystemAdminDashboard.css';
import api from '../../api';
import AuthContext from '../Auth/AuthContext';
import OrganizationsTab from './OrganizationsTab';
import WarehousesTab from './WarehousesTab';
import UsersTab from './UsersTab';


const SystemAdminDashboard = () => {
  const { authData } = useContext(AuthContext);
  const [organizations, setOrganizations] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [users, setUsers] = useState([]);
  const [activeTab, setActiveTab] = useState('Users');
  const [isModalOpen, setModalOpen] = useState(null);
  const [darkMode, setDarkMode] = useState(localStorage.getItem('darkMode') === 'true');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const userRole = authData?.role; 

  useEffect(() => {
    setLoading(true);
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
        setError('Error fetching data: ' + (error.response?.data?.error || error.message));
      } finally {
        setLoading(false);
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
  const openModal = (modalId) => setModalOpen(modalId);
  const closeModal = () => setModalOpen(null);

  if (loading) return <p>Loading...</p>;
  if (error) return <p>{error}</p>;

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

        {userRole === 'system_admin' && activeTab === 'Organizations' && (
          <OrganizationsTab
            organizations={organizations}
            isModalOpen={isModalOpen}
            openModal={openModal}
            closeModal={closeModal}
          />
        )}

        {userRole === 'admin' && activeTab === 'Warehouses' && (
          <WarehousesTab
            warehouses={warehouses}
            isModalOpen={isModalOpen}
            openModal={openModal}
            closeModal={closeModal}
          />
        )}

        {activeTab === 'Users' && (
          <UsersTab
            users={users}
            isModalOpen={isModalOpen}
            openModal={openModal}
            closeModal={closeModal}
          />
        )}
      </div>
    </div>
  );
};

export default SystemAdminDashboard;

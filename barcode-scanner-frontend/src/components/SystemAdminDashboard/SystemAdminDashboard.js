import React, { useState, useEffect, useContext } from 'react';
import './SystemAdminDashboard.css';
import api from '../../api'; // Import the axios instance
import AuthContext from '../Auth/AuthContext'; // Assuming you have an AuthContext

const SystemAdminDashboard = () => {
  const { authData } = useContext(AuthContext); // Get user data (including role)
  const [organizations, setOrganizations] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [users, setUsers] = useState([]);
  const [activeTab, setActiveTab] = useState('Users');
  const [isModalOpen, setModalOpen] = useState(null);
  const [darkMode, setDarkMode] = useState(localStorage.getItem('darkMode') === 'true');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const userRole = authData?.role; // Get user role from context

  // Fetch organizations, warehouses, and users when component mounts
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
        setError('Error fetching data: ' + error.response?.data?.error || error.message);
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

  const openTab = (event, tabName) => {
    setActiveTab(tabName);
  };

  const openModal = (modalId) => {
    setModalOpen(modalId);
  };

  const closeModal = () => {
    setModalOpen(null);
  };

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
        {/* Dark Mode Toggle */}
        <div className="header">
          <h2>Dark Mode</h2>
          <label className="switch">
            <input type="checkbox" checked={darkMode} onChange={toggleDarkMode} />
            <span className="slider round"></span>
          </label>
        </div>

        <div className="tabs">
          {/* Conditionally render tabs based on user role */}
          {userRole === 'system_admin' && (
            <button
              className={`tab-link ${activeTab === 'Organizations' ? 'active' : ''}`}
              onClick={(e) => openTab(e, 'Organizations')}
            >
              ორგანიზაციები
            </button>
          )}

          {userRole === 'admin' && (
            <button
              className={`tab-link ${activeTab === 'Warehouses' ? 'active' : ''}`}
              onClick={(e) => openTab(e, 'Warehouses')}
            >
              საწყობები
            </button>
          )}

          {/* Users tab is visible to both roles */}
          <button
            className={`tab-link ${activeTab === 'Users' ? 'active' : ''}`}
            onClick={(e) => openTab(e, 'Users')}
          >
            მომხმარებლები
          </button>
        </div>

        {/* Organizations Tab - visible only to system admin */}
        {userRole === 'system_admin' && activeTab === 'Organizations' && (
          <div id="Organizations" className="tab-content active">
            <button className="add-btn" onClick={() => openModal('organizationModal')}>
              ორგანიზაციის დამატება
            </button>
            <table>
              <thead>
                <tr>
                  <th>ორგანიზაცია</th>
                  <th>გსნ</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {organizations.map((org) => (
                  <tr key={org.id}>
                    <td>{org.name}</td>
                    <td>{org.identification_code}</td>
                    <td>Actions here</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Organization Modal */}
            {isModalOpen === 'organizationModal' && (
              <div className="modal">
                <div className="modal-content">
                  <span className="close-btn" onClick={closeModal}>
                    &times;
                  </span>
                  <h2>ორგანიზაციის დამატება</h2>
                  <form>
                    <div className="form-group">
                      <label htmlFor="orgName">ორგანიზაციის სახელი:</label>
                      <input type="text" id="orgName" required />
                    </div>
                    <button type="submit" className="add-btn">
                      დამატება
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Warehouses Tab - visible only to admin */}
        {userRole === 'admin' && activeTab === 'Warehouses' && (
          <div id="Warehouses" className="tab-content active">
            <button className="add-btn" onClick={() => openModal('warehouseModal')}>
              საწყობის დამატება
            </button>
            <table>
              <thead>
                <tr>
                  <th>სახელი</th>
                  <th>ორგანიზაცია</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {warehouses.map((wh) => (
                  <tr key={wh.id}>
                    <td>{wh.name}</td>
                    <td>{wh.organization_id}</td>
                    <td>Actions here</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Warehouse Modal */}
            {isModalOpen === 'warehouseModal' && (
              <div className="modal">
                <div className="modal-content">
                  <span className="close-btn" onClick={closeModal}>
                    &times;
                  </span>
                  <h2>საწყობის დამატება</h2>
                  <form>
                    <div className="form-group">
                      <label htmlFor="warehouseName">სახელი:</label>
                      <input type="text" id="warehouseName" required />
                    </div>
                    <button type="submit" className="add-btn">
                      დამატება
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Users Tab - visible to both system admin and admin */}
        {activeTab === 'Users' && (
          <div id="Users" className="tab-content active">
            <button className="add-btn" onClick={() => openModal('userModal')}>
              მომხმარებლის დამატება
            </button>
            <table>
              <thead>
                <tr>
                  <th>სახელი</th>
                  <th>Email</th>
                  <th>ორგანიზაცია</th>
                  <th>როლი</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.username}</td>
                    <td>{user.email}</td>
                    <td>{user.organization_id}</td>
                    <td>{user.role}</td>
                    <td>Actions here</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* User Modal */}
            {isModalOpen === 'userModal' && (
              <div className="modal">
                <div className="modal-content">
                  <span className="close-btn" onClick={closeModal}>
                    &times;
                  </span>
                  <h2>მომხმარებლის დამატება</h2>
                  <form>
                    <div className="form-group">
                      <label htmlFor="userName">სახელი:</label>
                      <input type="text" id="userName" required />
                    </div>
                    <button type="submit" className="add-btn">
                      დამატება
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SystemAdminDashboard;

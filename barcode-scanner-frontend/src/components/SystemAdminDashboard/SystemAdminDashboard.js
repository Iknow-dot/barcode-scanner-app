import React, { useState, useEffect } from 'react';
import './SystemAdminDashboard.css';
import api from '../../api'; // Import the axios instance

const SystemAdminDashboard = () => {
  const [organizations, setOrganizations] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [activeTab, setActiveTab] = useState('Organizations');
  const [isModalOpen, setModalOpen] = useState(null);
  const [darkMode, setDarkMode] = useState(localStorage.getItem('darkMode') === 'true');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Fetch organizations and warehouses when component mounts
  useEffect(() => {
    setLoading(true);
    const fetchData = async () => {
      try {
        const [orgRes, whRes] = await Promise.all([
          api.get('/organizations'),
          api.get('/warehouses')
        ]);

        setOrganizations(orgRes.data);
        setWarehouses(whRes.data);
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
      {/* <button onClick={logout}>Logout</button> */}

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
          <button
            className={`tab-link ${activeTab === 'Organizations' ? 'active' : ''}`}
            onClick={(e) => openTab(e, 'Organizations')}
          >
            ორგანიზაციები
          </button>
          <button
            className={`tab-link ${activeTab === 'Administrators' ? 'active' : ''}`}
            onClick={(e) => openTab(e, 'Administrators')}
          >
            მომხმარებლები
          </button>
        </div>

        <div id="Organizations" className={`tab-content ${activeTab === 'Organizations' ? 'active' : ''}`}>
          <button className="add-btn" onClick={() => openModal('organizationModal')}>
            ორგანიზაციის დამატება
          </button>
          {/* Organization table */}
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

        <div id="Administrators" className={`tab-content ${activeTab === 'Administrators' ? 'active' : ''}`}>
          <button className="add-btn" onClick={() => openModal('adminModal')}>
            მომხმარებლის დამატება
          </button>
          {/* Warehouses table */}
          <table>
            <thead>
              <tr>
                <th>სახელი</th>
                <th>Organization ID</th>
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
        </div>
      </div>
    </div>
  );
};

export default SystemAdminDashboard;

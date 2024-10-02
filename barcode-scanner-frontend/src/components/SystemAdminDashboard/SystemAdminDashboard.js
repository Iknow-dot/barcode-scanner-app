import React, { useState } from 'react';
import './SystemAdminDashboard.css';

const SystemAdminDashboard = () => {
  const [organization, setOrganization] = useState('');
  const [user, setUser] = useState('');
  const [activeTab, setActiveTab] = useState('Organizations');
  const [isModalOpen, setModalOpen] = useState(null);
  const [darkMode, setDarkMode] = useState(localStorage.getItem('darkMode') === 'true');

  const handleOrganizationSubmit = (e) => {
    e.preventDefault();
    console.log('Organization Submitted: ', organization);
  };

  const handleUserSubmit = (e) => {
    e.preventDefault();
    console.log('User Submitted: ', user);
  };

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
                <th>თანამშრომლების რაოდენობა</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Example Org</td>
                <td>123456</td>
                <td>50</td>
                <td>Actions here</td>
              </tr>
              {/* Dynamically populate more rows */}
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
                <form onSubmit={handleOrganizationSubmit}>
                  <div className="form-group">
                    <label htmlFor="orgName">ორგანიზაციის სახელი:</label>
                    <input
                      type="text"
                      id="orgName"
                      value={organization}
                      onChange={(e) => setOrganization(e.target.value)}
                      required
                    />
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
          {/* Administrators table */}
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
              <tr>
                <td>John Doe</td>
                <td>john@example.com</td>
                <td>Example Org</td>
                <td>Admin</td>
                <td>Actions here</td>
              </tr>
              {/* Dynamically populate more rows */}
            </tbody>
          </table>

          {/* Admin Modal */}
          {isModalOpen === 'adminModal' && (
            <div className="modal">
              <div className="modal-content">
                <span className="close-btn" onClick={closeModal}>
                  &times;
                </span>
                <h2>მომხმარებლის დამატება</h2>
                <form onSubmit={handleUserSubmit}>
                  <div className="form-group">
                    <label htmlFor="adminName">სახელი:</label>
                    <input
                      type="text"
                      id="adminName"
                      value={user}
                      onChange={(e) => setUser(e.target.value)}
                      required
                    />
                  </div>
                  <button type="submit" className="add-btn">
                    დამატება
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SystemAdminDashboard;

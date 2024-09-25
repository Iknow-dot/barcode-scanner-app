import React, { useState } from 'react';
import './SystemAdminDashboard.css';

const SystemAdminDashboard = () => {
  const [organization, setOrganization] = useState('');
  const [user, setUser] = useState('');
  const [warehouse, setWarehouse] = useState('');

  const handleOrganizationSubmit = (e) => {
    e.preventDefault();
    // Logic to submit organization data to backend
    console.log("Organization Submitted: ", organization);
  };

  const handleUserSubmit = (e) => {
    e.preventDefault();
    // Logic to submit user data to backend
    console.log("User Submitted: ", user);
  };

  const handleWarehouseSubmit = (e) => {
    e.preventDefault();
    // Logic to submit warehouse data to backend
    console.log("Warehouse Submitted: ", warehouse);
  };

  return (
    <div className="container">
      <h2>System Admin Dashboard</h2>

      <div className="form-section">
        <h3>Add Organization</h3>
        <form onSubmit={handleOrganizationSubmit}>
          <div className="form-group">
            <label htmlFor="organization">Organization</label>
            <input
              type="text"
              id="organization"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              required
            />
          </div>
          <button type="submit">Add Organization</button>
        </form>
      </div>

      <div className="form-section">
        <h3>Add User</h3>
        <form onSubmit={handleUserSubmit}>
          <div className="form-group">
            <label htmlFor="user">User</label>
            <input
              type="text"
              id="user"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              required
            />
          </div>
          <button type="submit">Add User</button>
        </form>
      </div>

      <div className="form-section">
        <h3>Add Warehouse</h3>
        <form onSubmit={handleWarehouseSubmit}>
          <div className="form-group">
            <label htmlFor="warehouse">Warehouse</label>
            <input
              type="text"
              id="warehouse"
              value={warehouse}
              onChange={(e) => setWarehouse(e.target.value)}
              required
            />
          </div>
          <button type="submit">Add Warehouse</button>
        </form>
      </div>
    </div>
  );
};

export default SystemAdminDashboard;

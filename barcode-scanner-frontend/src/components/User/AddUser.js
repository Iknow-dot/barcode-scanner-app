import React, { useState, useEffect, useContext } from 'react';
import './AddUser.css';
import api from '../../api';
import AuthContext from '../Auth/AuthContext';

const AddUser = ({ closeModal }) => {
  const { authData } = useContext(AuthContext);
  const [newUserData, setNewUserData] = useState({
    username: '',
    password: '',
    organization_id: '',
    role_name: '',
    ip_address: '',
    warehouse_ids: [] // For admin users adding users
  });

  const [organizations, setOrganizations] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false); // Check if the logged-in user is admin

  // Fetch organizations and warehouses if applicable
  useEffect(() => {
    const fetchData = async () => {
      try {
        if (authData?.role === 'system_admin') {
          const orgRes = await api.get('/organizations');
          setOrganizations(orgRes.data);
        } else if (authData?.role === 'admin') {
          const whRes = await api.get('/warehouses');
          setWarehouses(whRes.data);
          setIsAdmin(true);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };
    fetchData();
  }, [authData]);

  const handleInputChange = (e) => {
    setNewUserData({ ...newUserData, [e.target.name]: e.target.value });
  };

  const handleWarehouseChange = (e) => {
    const selectedWarehouses = Array.from(e.target.selectedOptions, option => option.value);
    setNewUserData({ ...newUserData, warehouse_ids: selectedWarehouses });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      // If admin, set the organization to their own organization and role to 'user'
      if (authData?.role === 'admin') {
        newUserData.role_name = 'user'; // Admin adds users with the role 'user'
        newUserData.organization_id = authData.organization_id; // Admin's organization
      } else {
        if (!newUserData.organization_id) {
          alert('Organization is required for system admin');
          return;
        }
      }

      // Make the API call to create the user
      const response = await api.post('/users', newUserData, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.status === 201) {
        alert('User created successfully!');
        setNewUserData({
          username: '',
          password: '',
          organization_id: '',
          role_name: '',
          ip_address: '',
          warehouse_ids: []
        });
        closeModal();
      }
    } catch (error) {
      console.error('Error creating user:', error.response?.data?.error || error.message);
      alert('Failed to create user: ' + (error.response?.data?.error || error.message));
    }
  };

  return (
    <div className="modal active">
      <div className="modal-content">
        <span className="close-btn" onClick={closeModal}>&times;</span>
        <h2>მომხმარებლის დამატება</h2>
        <form id="addUserForm" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username">მომხმარებლის სახელი:</label>
            <input
              type="text"
              id="username"
              name="username"
              value={newUserData.username}
              onChange={handleInputChange}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">პაროლი:</label>
            <input
              type="password"
              id="password"
              name="password"
              value={newUserData.password}
              onChange={handleInputChange}
              required
            />
          </div>

          {/* Organization field for system admin users */}
          {!isAdmin && (
            <div className="form-group">
              <label htmlFor="organization">ორგანიზაცია:</label>
              <select
                id="organization"
                name="organization_id"
                value={newUserData.organization_id}
                onChange={handleInputChange}
                required
              >
                <option value="">აირჩიეთ ორგანიზაცია</option>
                {organizations.map(org => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="role">როლი:</label>
            <select
              id="role"
              name="role_name"
              value={newUserData.role_name}
              onChange={handleInputChange}
              required
            >
              {/* System admin defaults to 'admin', admin defaults to 'user' */}
              <option value={isAdmin ? 'user' : 'admin'}>{isAdmin ? 'user' : 'admin'}</option>
              {!isAdmin && <option value="system_admin">system admin</option>}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="ipAddress">IP მისამართი:</label>
            <input
              type="text"
              id="ipAddress"
              name="ip_address"
              value={newUserData.ip_address}
              onChange={handleInputChange}
              required
            />
          </div>

          {/* Warehouse field only for admin users */}
          {isAdmin && (
            <div className="form-group">
              <label htmlFor="warehouses">საწყობები:</label>
              <select
                id="warehouses"
                name="warehouse_ids"
                multiple
                value={newUserData.warehouse_ids}
                onChange={handleWarehouseChange}
                required
              >
                {warehouses.map(wh => (
                  <option key={wh.id} value={wh.id}>{wh.name}</option>
                ))}
              </select>
            </div>
          )}

          <button type="submit" className="add-btn">დამატება</button>
        </form>
      </div>
    </div>
  );
};

export default AddUser;

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
    role_name: authData?.role === 'admin' ? 'user' : 'admin',
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
    const warehouseId = e.target.value;
    const newWarehouseIds = newUserData.warehouse_ids.includes(warehouseId)
      ? newUserData.warehouse_ids.filter(id => id !== warehouseId)
      : [...newUserData.warehouse_ids, warehouseId];
    setNewUserData({ ...newUserData, warehouse_ids: newWarehouseIds });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Set organization_id and role_name for admin before validation checks
    if (authData?.role === 'admin') {
      newUserData.organization_id = authData.organization_id; // Admin's organization
      newUserData.role_name = 'user'; // Admin adds users with the role 'user'
        // console.log("auth", authData)

    }

    // Check required fields
    if (!newUserData.username || !newUserData.password || !newUserData.role_name || !newUserData.organization_id || !newUserData.ip_address || (isAdmin && newUserData.warehouse_ids.length === 0)) {
      if (!newUserData.username) {
        alert("username field is required.");
      } else if (!newUserData.password) {
        alert("password field is required.");
      } else if (!newUserData.role_name) {
        //console.log(newUserData);
        alert("role_name field is required.");
      } else if (!newUserData.ip_address) {
        alert("ip_address field is required.");
      } else if (isAdmin && newUserData.warehouse_ids.length === 0) {
        alert("warehouse_ids field is required.");
      }
      return;
    }

    try {
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
            <label htmlFor="username">სახელი:</label>
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
              <option value={isAdmin ? 'user' : 'admin'}>{isAdmin ? 'user' : 'admin'}</option>
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

          {isAdmin && (
            <div className="form-group">
              <label htmlFor="warehouses">საწყობები:</label>
              <div id="warehouse-container">
                {warehouses.map(wh => (
                  <div className="warehouse-display" key={wh.id}>
                    <input
                      type="checkbox"
                      id={`warehouse${wh.id}`}
                      name="warehouses"
                      value={wh.id}
                      checked={newUserData.warehouse_ids.includes(wh.id)}
                      onChange={handleWarehouseChange}
                    />
                    <label htmlFor={`warehouse${wh.id}`}>{wh.name}</label>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button type="submit" className="add-btn">დამატება</button>
        </form>
      </div>
    </div>
  );
};

export default AddUser;

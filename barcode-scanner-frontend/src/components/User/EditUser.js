import React, { useState, useEffect, useContext } from 'react';
import './AddUser.css';
import api from '../../api';
import AuthContext from '../Auth/AuthContext';

const EditUser = ({ userData, closeModal }) => {
  const { authData } = useContext(AuthContext);
  const [editUserData, setEditUserData] = useState({
    username: '',
    password: '',
    organization_id: '',
    role_name: '',
    ip_address: '',
    warehouse_ids: [],
  });

  const [organizations, setOrganizations] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);

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

        // Initialize form with existing user data
        setEditUserData(userData);

      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };
    fetchData();
  }, [authData, userData]);

  const handleInputChange = (e) => {
    setEditUserData({ ...editUserData, [e.target.name]: e.target.value });
  };

  const handleWarehouseChange = (e) => {
    const selectedWarehouses = Array.from(e.target.selectedOptions, option => option.value);
    setEditUserData({ ...editUserData, warehouse_ids: selectedWarehouses });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/users/${editUserData.id}`, editUserData);
      alert('User updated successfully!');
      closeModal();
    } catch (error) {
      console.error('Error updating user:', error.response?.data?.error || error.message);
      alert('Failed to update user: ' + (error.response?.data?.error || error.message));
    }
  };

  return (
    <div className="modal active">
      <div className="modal-content">
        <span className="close-btn" onClick={closeModal}>&times;</span>
        <h2>მომხმარებლის რედაქტირება</h2>
        <form id="editUserForm" onSubmit={handleSubmit}>
          {/* Form fields are similar to AddUser, with editUserData instead */}
          {/* Add other fields similarly */}
          <button type="submit" className="edit-btn">განახლება</button>
        </form>
      </div>
    </div>
  );
};

export default EditUser;

import React, { useState, useEffect, useContext } from 'react';
import './AddUser.css'; // Use appropriate CSS file
import api, { getUserWarehousesByUserId } from '../../api';
import AuthContext from '../Auth/AuthContext';

const EditUser = ({ userData, closeModal }) => {
  const { authData } = useContext(AuthContext);
  const [editUserData, setEditUserData] = useState({
    username: '',
    password: '',
    organization_id: '',
    role_name: '',
    ip_address: '',
    warehouse_ids: [], // Ensure this is always an array
  });

  const [organizations, setOrganizations] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [userwarehouses, setuserWarehouses] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      if (authData?.role === 'system_admin') {
        const orgRes = await api.get('/organizations');
        setOrganizations(orgRes.data);
      } 
      
      if (authData?.role === 'admin' && userData.role_name === 'user') {
        const whRes = await api.get('/warehouses');
        setWarehouses(whRes.data);
        setIsAdmin(true);
      }

  
      if (authData?.role === 'admin' && userData.role_name === 'user' && userData.id) {
        const userSpecificWarehouses = await getUserWarehousesByUserId(userData.id);
        setuserWarehouses(userSpecificWarehouses.map(wh => wh.id));
  
        setEditUserData(prevState => ({
          ...prevState,
          warehouse_ids: userSpecificWarehouses.map(wh => wh.id) // Set initially checked warehouses
        }));
  
      }
      // Initialize form with existing user data
  
      setEditUserData(prevState => ({
        ...prevState,
        ...userData
      }));
    };
  
    fetchData();
  
  }, [authData, userData]);

  const handleInputChange = (e) => {
    setEditUserData(prevState => ({ ...prevState, [e.target.name]: e.target.value }));
  };

  const handleWarehouseChange = (e) => {
    const warehouseId = e.target.value;
    const isAlreadySelected = editUserData.warehouse_ids.includes(warehouseId);
  
    // Toggle the presence of warehouseId in the array
    const newWarehouseIds = isAlreadySelected
      ? editUserData.warehouse_ids.filter(id => id !== warehouseId) // Remove the ID if it's already included
      : [...editUserData.warehouse_ids, warehouseId]; // Add the ID if it's not included
  
    setEditUserData(prevState => ({
      ...prevState,
      warehouse_ids: newWarehouseIds // Update state with the new array of IDs
    }));
  };



  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      // console.log(editUserData);
      await api.put(`/users/${editUserData.id}`, editUserData);
      alert('მომხმარებელი წარმატებით განახლდა!');
      closeModal();
    } catch (error) {
      console.error('შეცდომა მომხმარებლის განახლებისას:', error.response?.data?.error || error.message);
      alert('ვერ მოხერხდა მომხმარებლის განახლება: ' + (error.response?.data?.error || error.message));
    }
  };

  return (
    <div className="modal active">
      <div className="modal-content">
        <span className="close-btn" onClick={closeModal}>&times;</span>
        <h2>მომხმარებლის განახლება</h2>
        <form id="editUserForm" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username">სახელი:</label>
            <input
              type="text"
              id="username"
              name="username"
              value={editUserData.username}
              onChange={handleInputChange}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">პაროლი (დატოვეთ ცარიელი თუ ცვლილება არ გსურთ):</label>
            <input
              type="password"
              id="password"
              name="password"
              value={editUserData.password}
              onChange={handleInputChange}
            />
          </div>
          {!isAdmin && (
            <div className="form-group">
              <label htmlFor="organization">ორგანიზაცია:</label>
              <select
                id="organization"
                name="organization_id"
                value={editUserData.organization_id}
                onChange={handleInputChange}
                required={authData?.role === 'system_admin'}
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
              value={editUserData.role_name}
              onChange={handleInputChange}
              required
            >
              <option value={editUserData.role_name}>{editUserData.role_name}</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="ipAddress">IP მისამართი:</label>
            <input
              type="text"
              id="ipAddress"
              name="ip_address"
              value={editUserData.ip_address}
              onChange={handleInputChange}
              required = {editUserData.role_name === "user"}
            />
          </div>
          {isAdmin && (
            <div className="form-group">
              <label htmlFor="warehouses">საწყობი:</label>
              <div id="warehouse-container">
                {warehouses.map(wh => (
                  <div className="warehouse-display" key={wh.id}>
                    <input
                      type="checkbox"
                      id={`warehouse${wh.id}`}
                      name="warehouses"
                      value={wh.id}
                      checked={editUserData.warehouse_ids.includes(wh.id)}
                      onChange={handleWarehouseChange}
                    />
                    <label htmlFor={`warehouse${wh.id}`}>{wh.name}</label>
                  </div>
                ))}
              </div>
            </div>
          )}
          <button type="submit" className="edit-btn">განახლება</button>
        </form>
      </div>
    </div>
  );
};

export default EditUser;

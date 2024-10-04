import React, { useState } from 'react';
import './AddWarehouse.css';
import api from '../../api'; // Ensure you have an api setup for handling requests

const AddWarehouse = ({ closeModal, organizationId }) => {
  const [newWarehouseData, setNewWarehouseData] = useState({
    name: '',
    code: '',
    organization_id: organizationId, // Automatically set the organization ID
  });

  const handleInputChange = (e) => {
    setNewWarehouseData({ ...newWarehouseData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      // Send data to API to create a new warehouse
      await api.post('/warehouses', newWarehouseData);
      alert('Warehouse added successfully!');
      closeModal();
    } catch (error) {
      console.error('Error adding warehouse:', error);
      alert('Failed to add warehouse');
    }
  };

  return (
    <div className="modal active">
      <div className="modal-content">
        <span className="close-btn" onClick={closeModal}>&times;</span>
        <h2>საწყობის დამატება</h2>
        <form id="addWarehouseForm" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="warehouseName">სახელი:</label>
            <input
              type="text"
              id="warehouseName"
              name="name"
              value={newWarehouseData.name}
              onChange={handleInputChange}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="warehouseCode">კოდი:</label>
            <input
              type="text"
              id="warehouseCode"
              name="code"
              value={newWarehouseData.code}
              onChange={handleInputChange}
              required
            />
          </div>
          <button type="submit" className="add-btn">დამატება</button>
        </form>
      </div>
    </div>
  );
};

export default AddWarehouse;

import React, { useState, useEffect } from 'react';
import './AddWarehouse.css';
import api from '../../api';

const EditWarehouse = ({ warehouseData, closeModal }) => {
  const [editWarehouseData, setEditWarehouseData] = useState({
    name: '',
    code: '',
    organization_id: warehouseData.organization_id,
  });

  useEffect(() => {
    if (warehouseData) {
      setEditWarehouseData(warehouseData);
    }
  }, [warehouseData]);

  const handleInputChange = (e) => {
    setEditWarehouseData({ ...editWarehouseData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/warehouses/${warehouseData.id}`, editWarehouseData);
      alert('საწყობი განახლდა წარმატებით!');
      closeModal();
    } catch (error) {
      console.error('შეცდომა საწყობის განახლებისას:', error);
      alert('ვერ მოხერხდა საწყობის განახლება');
    }
  };

  return (
    <div className="modal active">
      <div className="modal-content">
        <span className="close-btn" onClick={closeModal}>&times;</span>
        <h2>საწყობის განახლება</h2>
        <form id="editWarehouseForm" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="warehouseName">სახელი:</label>
            <input
              type="text"
              id="warehouseName"
              name="name"
              value={editWarehouseData.name}
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
              value={editWarehouseData.code}
              onChange={handleInputChange}
              required
            />
          </div>
          <button type="submit" className="add-btn">განახლება</button>
        </form>
      </div>
    </div>
  );
};

export default EditWarehouse;

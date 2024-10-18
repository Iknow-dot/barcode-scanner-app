import React, { useState, useEffect } from 'react';
import api from '../../api';

const WarehousesTab = ({ warehouses: initialWarehouses, openModal }) => {
  const [warehouses, setWarehouses] = useState(initialWarehouses);
  const [organizations, setOrganizations] = useState({});

  useEffect(() => {
    const fetchOrganizations = async () => {
      try {
        const response = await api.get('/organizations');
        const orgMap = response.data.reduce((acc, org) => {
          acc[org.id] = org.name;
          return acc;
        }, {});
        setOrganizations(orgMap);
      } catch (error) {
        console.error('Error fetching organizations:', error);
      }
    };
    fetchOrganizations();
  }, []);

  const handleEdit = (warehouse) => {
    openModal('editWarehouse', warehouse);
  };

  const handleDelete = async (warehouseId) => {
    if (window.confirm("ნამდვილად გსურთ ამ საწყობის წაშლა?")) {
      try {
        await api.delete(`/warehouses/${warehouseId}`);
        setWarehouses(currentWarehouses => currentWarehouses.filter(wh => wh.id !== warehouseId));
      } catch (error) {
        console.error("საწყობის წაშლის შეცდომა:", error);
      }
    }
  };

  return (
    <div id="Warehouses" className="tab-content active">
      <button className="add-btn" onClick={() => openModal('addWarehouse')}>
        საწყობის დამატება
      </button>
      <table>
        <thead>
          <tr>
            <th>სახელი</th>
            <th>ორგანიზაცია</th>
            <th>ქმედებები</th>
          </tr>
        </thead>
        <tbody>
          {warehouses.map((wh) => (
            <tr key={wh.id}>
              <td>{wh.name}</td>
              <td>{organizations[wh.organization_id] || 'N/A'}</td>
              <td>
                <button className="edit-btn" onClick={() => handleEdit(wh)}>
                  რედაქტირება
                </button>
                <button className="delete-btn" onClick={() => handleDelete(wh.id)}>
                  წაშლა
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default WarehousesTab;

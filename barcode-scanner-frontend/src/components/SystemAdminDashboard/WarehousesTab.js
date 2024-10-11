import React from 'react';
import api from '../../api';

const WarehousesTab = ({ warehouses, openModal }) => {
  const handleEdit = (warehouse) => {
    openModal('editWarehouse', warehouse);
  };

  const handleDelete = async (warehouseId) => {
    if (window.confirm("ნამდვილად გსურთ ამ საწყობის წაშლა?")) {
      try {
        await api.delete(`/warehouses/${warehouseId}`);
        window.location.reload(); // Refresh the list after deletion
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
              <td>{wh.organization_id}</td>
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

import React from 'react';

const WarehousesTab = ({ warehouses, isModalOpen, openModal, closeModal }) => (
  <div id="Warehouses" className="tab-content active">
    <button className="add-btn" onClick={() => openModal('warehouseModal')}>
      საწყობის დამატება
    </button>
    <table>
      <thead>
        <tr>
          <th>სახელი</th>
          <th>ორგანიზაცია</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {warehouses.map((wh) => (
          <tr key={wh.id}>
            <td>{wh.name}</td>
            <td>{wh.organization_id}</td>
            <td>Actions here</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default WarehousesTab;

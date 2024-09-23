import React from 'react';
import { Link } from 'react-router-dom';

const WarehouseList = ({ warehouses, onDelete }) => {
  return (
    <div>
      <h1>Warehouses</h1>
      <Link to="/add-warehouse" className="button add-button">Add New Warehouse</Link>
      <ul className="warehouse-list">
        {warehouses.map(warehouse => (
          <li key={warehouse.id} className="warehouse-item">
            <span>{warehouse.name}</span>
            <div className="actions">
              <Link to={`/edit-warehouse/${warehouse.id}`} className="button edit-button">Edit</Link>
              <button onClick={() => onDelete(warehouse.id)} className="button delete-button">Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default WarehouseList;

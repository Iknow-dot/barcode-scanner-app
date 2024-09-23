import React, { useCallback } from 'react';
import { useHistory } from 'react-router-dom';
import WarehouseForm from './WarehouseForm';
import { addWarehouse } from '../api'; // Ensure this API function is properly set up

const AddWarehouse = () => {
  const history = useHistory();

  const handleFormSubmit = useCallback(async (data) => {
    await addWarehouse(data);
    history.push('/warehouses');
  }, [history]);

  return (
    <div>
      <h2>Add New Warehouse</h2>
      <WarehouseForm onSubmit={handleFormSubmit} />
    </div>
  );
};

export default AddWarehouse;

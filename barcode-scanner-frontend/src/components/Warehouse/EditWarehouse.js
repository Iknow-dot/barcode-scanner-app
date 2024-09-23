import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useHistory } from 'react-router-dom';
import WarehouseForm from './WarehouseForm';
import { getWarehouse, updateWarehouse } from '../api'; // Ensure these API functions are set up

const EditWarehouse = () => {
  const { id } = useParams();
  const history = useHistory();
  const [warehouse, setWarehouse] = useState({});

  useEffect(() => {
    const fetchWarehouse = async () => {
      const data = await getWarehouse(id);
      setWarehouse(data);
    };
    fetchWarehouse();
  }, [id]);

  const handleFormSubmit = useCallback(async (data) => {
    await updateWarehouse(id, data);
    history.push('/warehouses');
  }, [id, history]);

  return (
    <div>
      <h2>Edit Warehouse</h2>
      <WarehouseForm onSubmit={handleFormSubmit} initialData={warehouse} />
    </div>
  );
};

export default EditWarehouse;

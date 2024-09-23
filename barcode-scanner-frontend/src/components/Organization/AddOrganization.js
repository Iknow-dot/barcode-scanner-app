import React, { useCallback } from 'react';
import { useHistory } from 'react-router-dom';
import OrganizationForm from './OrganizationForm';
import { addOrganization } from '../api'; // Ensure this API function is properly set up

const AddOrganization = () => {
  const history = useHistory();

  const handleFormSubmit = useCallback(async (data) => {
    await addOrganization(data);
    history.push('/organizations');
  }, [history]);

  return (
    <div>
      <h2>Add New Organization</h2>
      <OrganizationForm onSubmit={handleFormSubmit} />
    </div>
  );
};

export default AddOrganization;

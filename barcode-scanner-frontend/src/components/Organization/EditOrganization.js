import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useHistory } from 'react-router-dom';
import OrganizationForm from './OrganizationForm';
import { getOrganization, updateOrganization } from '../api'; // Ensure these API functions are set up

const EditOrganization = () => {
  const { id } = useParams();
  const history = useHistory();
  const [organization, setOrganization] = useState({});

  useEffect(() => {
    const fetchOrganization = async () => {
      const data = await getOrganization(id);
      setOrganization(data);
    };
    fetchOrganization();
  }, [id]);

  const handleFormSubmit = useCallback(async (data) => {
    await updateOrganization(id, data);
    history.push('/organizations');
  }, [id, history]);

  return (
    <div>
      <h2>Edit Organization</h2>
      <OrganizationForm onSubmit={handleFormSubmit} initialData={organization} />
    </div>
  );
};

export default EditOrganization;

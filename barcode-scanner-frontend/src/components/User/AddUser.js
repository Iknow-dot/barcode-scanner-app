import React, { useCallback } from 'react';
import { useHistory } from 'react-router-dom';
import UserForm from './UserForm';
import { addUser } from '../api'; // Ensure this API function is properly set up

const AddUser = () => {
  const history = useHistory();

  const handleFormSubmit = useCallback(async (data) => {
    await addUser(data);
    history.push('/users');
  }, [history]);

  return (
    <div>
      <h2>Add New User</h2>
      <UserForm onSubmit={handleFormSubmit} />
    </div>
  );
};

export default AddUser;

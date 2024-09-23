import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useHistory } from 'react-router-dom';
import UserForm from './UserForm';
import { getUser, updateUser } from '../api'; // Ensure these API functions are set up

const EditUser = () => {
  const { id } = useParams();
  const history = useHistory();
  const [user, setUser] = useState({});

  useEffect(() => {
    const fetchUser = async () => {
      const data = await getUser(id);
      setUser(data);
    };
    fetchUser();
  }, [id]);

  const handleFormSubmit = useCallback(async (data) => {
    await updateUser(id, data);
    history.push('/users');
  }, [id, history]);

  return (
    <div>
      <h2>Edit User</h2>
      <UserForm onSubmit={handleFormSubmit} initialData={user} />
    </div>
  );
};

export default EditUser;

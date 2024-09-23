import React, { useState, useEffect } from 'react';

const UserForm = ({ onSubmit, initialData = {} }) => {
  const [data, setData] = useState(initialData);

  useEffect(() => {
    setData(initialData);  // Reset form when initialData changes
  }, [initialData]);

  const handleChange = (e) => {
    setData({ ...data, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(data);
  };

  return (
    <form onSubmit={handleSubmit} className="user-form">
      <label htmlFor="username">Username:</label>
      <input
        type="text"
        id="username"
        name="username"
        value={data.username || ''}
        onChange={handleChange}
        required
      />
      <label htmlFor="password">Password:</label>
      <input
        type="password"
        id="password"
        name="password"
        value={data.password || ''}
        onChange={handleChange}
        required
      />
      <button type="submit" className="submit-button">Save</button>
    </form>
  );
};

export default UserForm;

import React, { useState, useEffect } from 'react';

const OrganizationForm = ({ onSubmit, initialData = {} }) => {
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
    <form onSubmit={handleSubmit} className="organization-form">
      <label htmlFor="name">Organization Name:</label>
      <input
        type="text"
        id="name"
        name="name"
        value={data.name || ''}
        onChange={handleChange}
        required
      />
      <button type="submit" className="submit-button">Save</button>
    </form>
  );
};

export default OrganizationForm;

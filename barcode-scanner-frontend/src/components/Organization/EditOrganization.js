import React, { useState, useEffect } from 'react';

const EditOrganization = ({ organizationData, handleEditOrganization, closeModal }) => {
  const [orgData, setOrgData] = useState({
    name: '',
    identification_code: '',
    employees_count: '',
    web_service_url: '',
    org_username: '',    // New field
    org_password: ''     // New field (optional)
  });

  // Populate the form with existing organization data when the component loads
  useEffect(() => {
    if (organizationData) {
      setOrgData(organizationData);
    }
  }, [organizationData]);

  // Handle input changes for the form fields
  const handleInputChange = (e) => {
    setOrgData({ ...orgData, [e.target.name]: e.target.value });
  };

  // Handle form submission
  const handleSubmit = (e) => {
    e.preventDefault();
    // Ensure the org_password is optional (only include it if provided)
    const updatedOrgData = { ...orgData };
    if (!updatedOrgData.org_password) {
      delete updatedOrgData.org_password;  // Do not send the password if it's not being changed
    }
    handleEditOrganization(updatedOrgData);  // Call the function to edit the organization
    closeModal();  // Close the modal
  };

  return (
    <div className="modal active">
      <div className="modal-content">
        <span className="close-btn" onClick={closeModal}>&times;</span>
        <h2>ორგანიზაციის განახლება</h2>
        <form id="editOrganizationForm" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="organizationName">ორგანიზაციის სახელი:</label>
            <input
              type="text"
              id="organizationName"
              name="name"
              value={orgData.name}
              onChange={handleInputChange}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="identificationCode">საიდენტიფიკაციო კოდი:</label>
            <input
              type="text"
              id="identificationCode"
              name="identification_code"
              value={orgData.identification_code}
              onChange={handleInputChange}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="employeesCount">თანამშრომლების რაოდენობა:</label>
            <input
              type="number"
              id="employeesCount"
              name="employees_count"
              value={orgData.employees_count}
              onChange={handleInputChange}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="webServiceAddress">ვებ სერვისის მისამართი:</label>
            <input
              type="text"
              id="webServiceAddress"
              name="web_service_url"
              value={orgData.web_service_url}
              onChange={handleInputChange}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="orgUsername">მომხმარებლის სახელი:</label>
            <input
              type="text"
              id="orgUsername"
              name="org_username"
              value={orgData.org_username}
              onChange={handleInputChange}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="orgPassword">პაროლი (თუ გსურთ ცვლილება):</label>
            <input
              type="password"
              id="orgPassword"
              name="org_password"
              value={orgData.org_password}
              onChange={handleInputChange}
              placeholder="Enter new password if changing"
            />
          </div>
          <button type="submit" className="add-btn">განახლება</button>
        </form>
      </div>
    </div>
  );
};

export default EditOrganization;

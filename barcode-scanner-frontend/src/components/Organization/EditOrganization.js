import React, { useState, useEffect } from 'react';
import './AddOrganization.css';

const EditOrganization = ({ organizationData, handleEditOrganization, closeModal }) => {
  const [orgData, setOrgData] = useState({
    name: '',
    identification_code: '',
    employees_count: '',
    web_service_url: ''
  });

  useEffect(() => {
    if (organizationData) {
      setOrgData(organizationData);
    }
  }, [organizationData]);

  const handleInputChange = (e) => {
    setOrgData({ ...orgData, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    handleEditOrganization(orgData);  // Call the edit function
    closeModal();
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
          <button type="submit" className="add-btn">განახლება</button>
        </form>
      </div>
    </div>
  );
};

export default EditOrganization;

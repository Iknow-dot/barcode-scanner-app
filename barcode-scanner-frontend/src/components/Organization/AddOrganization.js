import React, { useState } from 'react';
import './AddOrganization.css';
import api from '../../api';  // Import your custom Axios instance

const AddOrganization = ({ closeModal }) => {
  const [newOrgData, setNewOrgData] = useState({
    name: '',
    identification_code: '',
    employees_count: '',
    web_service_url: '',
    org_username: '',    // New field
    org_password: ''     // New field
  });

  const handleInputChange = (e) => {
    setNewOrgData({ ...newOrgData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      // Make API call using the custom API instance from api.js
      const response = await api.post('/organizations', newOrgData);

      if (response.status === 201) {
        alert('ორგანიზაცია წარმატებით შეიქმნა!');
        setNewOrgData({ name: '', identification_code: '', employees_count: '', web_service_url: '', org_username: '', org_password: '' });  // Reset all fields
        closeModal();
      }
    } catch (error) {
      console.error('შეცდომა ორგანიზაციის შექმნისას:', error.response?.data?.error || error.message);
      alert('ვერ მოხერხდა ორგანიზაციის შექმნა: ' + (error.response?.data?.error || error.message));
    }
  };

  return (
    <div className="modal active">
      <div className="modal-content">
        <span className="close-btn" onClick={closeModal}>&times;</span>
        <h2>ორგანიზაციის დამატება</h2>
        <form id="addOrganizationForm" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="organizationName">ორგანიზაციის სახელი:</label>
            <input type="text" id="organizationName" name="name" value={newOrgData.name} onChange={handleInputChange} required />
          </div>
          <div className="form-group">
            <label htmlFor="identificationCode">საიდენტიფიკაციო კოდი:</label>
            <input type="text" id="identificationCode" name="identification_code" value={newOrgData.identification_code} onChange={handleInputChange} required />
          </div>
          <div className="form-group">
            <label htmlFor="employeesCount">თანამშრომლების რაოდენობა:</label>
            <input type="number" id="employeesCount" name="employees_count" value={newOrgData.employees_count} onChange={handleInputChange} required />
          </div>
          <div className="form-group">
            <label htmlFor="webServiceAddress">ვებ სერვისის მისამართი:</label>
            <input type="text" id="webServiceAddress" name="web_service_url" value={newOrgData.web_service_url} onChange={handleInputChange} required />
          </div>
          <div className="form-group">
            <label htmlFor="orgUsername">მომხმარებლის სახელი:</label>
            <input type="text" id="orgUsername" name="org_username" value={newOrgData.org_username} onChange={handleInputChange} required />
          </div>
          <div className="form-group">
            <label htmlFor="orgPassword">პაროლი:</label>
            <input type="password" id="orgPassword" name="org_password" value={newOrgData.org_password} onChange={handleInputChange} required />
          </div>
          <button type="submit" className="add-btn">დამატება</button>
        </form>
      </div>
    </div>
  );
};

export default AddOrganization;

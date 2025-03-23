import React, {useState} from 'react';
import api from '../../api';
import {Form, Input, Modal} from "antd";  // Import your custom Axios instance

const AddOrganization = ({closeModal, isModalOpen}) => {
  const [newOrgData, setNewOrgData] = useState({
    name: '',
    identification_code: '',
    employees_count: '',
    web_service_url: '',
    org_username: '',    // New field
    org_password: ''     // New field
  });

  const handleInputChange = (e) => {
    setNewOrgData({...newOrgData, [e.target.name]: e.target.value});
  };

  const handleSubmit = async (organization) => {

    try {
      // Make API call using the custom API instance from api.js
      const response = await api.post('/organizations', organization);

      if (response.status === 201) {
        alert('ორგანიზაცია წარმატებით შეიქმნა!');
        setNewOrgData({
          name: '',
          identification_code: '',
          employees_count: '',
          web_service_url: '',
          org_username: '',
          org_password: ''
        });  // Reset all fields
        closeModal();
      }
    } catch (error) {
      console.error('შეცდომა ორგანიზაციის შექმნისას:', error.response?.data?.error || error.message);
      alert('ვერ მოხერხდა ორგანიზაციის შექმნა: ' + (error.response?.data?.error || error.message));
    }
  };

  return (
      <Modal
          title="ორგანიზაციის დამატება"
          onCancel={closeModal}
          footer={null}
          open={isModalOpen}
      >
        <Form
          layout="vertical"
          onFinish={handleSubmit}
        >
          <Form.Item
              label="ორგანიზაციის სახელი:"
              name="name"
              rules={[
                {
                  required: true,
                  message: 'შეავსეთ ორგანიზაციის სახელი!',
                },
              ]}
          >
            <Input/>
          </Form.Item>

          <Form.Item
              label="საიდენტიფიკაციო კოდი"
              name="identification_code"
              rules={[
                {
                  required: true,
                  message: 'შეავსეთ საიდენტიფიკაციო კოდი!',
                },
              ]}
          >
            <Input/>
          </Form.Item>

          <Form.Item
              label="თანამშრომლების რაოდენობა"
              name="employees_count"
              rules={[
                {
                  required: true,
                  message: 'შეავსეთ თანამშრომლების რაოდენობა!',
                }
              ]}
          >
            <label htmlFor="employeesCount">თანამშრომლების რაოდენობა:</label>
            <Input/>
          </Form.Item>


        </Form>

        <span className="close-btn" onClick={closeModal}>&times;</span>
        <h2>ორგანიზაციის დამატება</h2>
        <form id="addOrganizationForm" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="organizationName">ორგანიზაციის სახელი:</label>
            <input type="text" id="organizationName" name="name" value={newOrgData.name} onChange={handleInputChange}
                   required/>
          </div>
          <div className="form-group">
            <label htmlFor="identificationCode">საიდენტიფიკაციო კოდი:</label>
            <input type="text" id="identificationCode" name="identification_code" value={newOrgData.identification_code}
                   onChange={handleInputChange} required/>
          </div>
          <div className="form-group">
            <label htmlFor="employeesCount">თანამშრომლების რაოდენობა:</label>
            <input type="number" id="employeesCount" name="employees_count" value={newOrgData.employees_count}
                   onChange={handleInputChange} required/>
          </div>
          <div className="form-group">
            <label htmlFor="webServiceAddress">ვებ სერვისის მისამართი:</label>
            <input type="text" id="webServiceAddress" name="web_service_url" value={newOrgData.web_service_url}
                   onChange={handleInputChange} required/>
          </div>
          <div className="form-group">
            <label htmlFor="orgUsername">მომხმარებლის სახელი:</label>
            <input type="text" id="orgUsername" name="org_username" value={newOrgData.org_username}
                   onChange={handleInputChange} required/>
          </div>
          <div className="form-group">
            <label htmlFor="orgPassword">პაროლი:</label>
            <input type="password" id="orgPassword" name="org_password" value={newOrgData.org_password}
                   onChange={handleInputChange}/>
          </div>
          <button type="submit" className="add-btn">დამატება</button>
        </form>
      </Modal>
  );
};

export default AddOrganization;

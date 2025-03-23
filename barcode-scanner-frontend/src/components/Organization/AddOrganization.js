import React from 'react';
import api from '../../api';
import {Form, Input, InputNumber} from "antd";
import ModalForm from "../ModalForm";  // Import your custom Axios instance

const AddOrganization = ({visible, setVisible, onFinish}) => {
  const handleSubmit = async (organization) => {

    try {
      // Make API call using the custom API instance from api.js
      const response = await api.post('/organizations', organization);

      if (response.status === 201) {
        alert('ორგანიზაცია წარმატებით შეიქმნა!');
      }
    } catch (error) {
      console.error('შეცდომა ორგანიზაციის შექმნისას:', error.response?.data?.error || error.message);
      alert('ვერ მოხერხდა ორგანიზაციის შექმნა: ' + (error.response?.data?.error || error.message));
    }
  };

  return (
      <ModalForm
          visible={visible}
          setVisible={setVisible}
          onFinish={onFinish}
          title="ორგანიზაციის დამატება"
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
          <InputNumber/>
        </Form.Item>

        <Form.Item
            label="ვებ სერვისის მისამართი"
            name="web_service_url"
            rules={[
              {
                required: true,
                message: 'შეავსეთ ვებ სერვისის მისამართი!',
              }
            ]}
        >
          <Input/>
        </Form.Item>

        <Form.Item
            label="მომხმარელის სახელი"
            name="username"
            rules={[
              {
                required: true,
                message: 'შეავსეთ მომხმარელის სახელი!',
              }
            ]}
        >
          <Input/>
        </Form.Item>

        <Form.Item
            label="პაროლი"
            name="password"
            rules={[
              {
                required: true,
                message: 'შეავსეთ პაროლი!',
              }
            ]}
        >
          <Input.Password/>
        </Form.Item>
      </ModalForm>
  );
};

export default AddOrganization;

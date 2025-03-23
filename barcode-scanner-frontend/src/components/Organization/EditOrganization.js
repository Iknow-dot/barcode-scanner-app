import React from 'react';
import ModalForm from "../ModalForm";
import {Form, Input, InputNumber} from "antd";

const EditOrganization = ({visible, setVisible, onFinish}) => {
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

export default EditOrganization;

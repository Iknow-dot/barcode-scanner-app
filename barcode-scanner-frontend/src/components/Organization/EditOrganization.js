import React from 'react';
import ModalForm from "../ModalForm";
import {Button, Form, Input, InputNumber} from "antd";

const EditOrganization = ({visible, setVisible, onFinish, object}) => {
  return (
      <ModalForm
          object={object}
          title="ორგანიზაციის დამატება"
          visible={visible}
          setVisible={setVisible}
          onFinish={(data) => onFinish(data, object)}
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
            name="org_username"
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
            name="org_password"
            rules={[
              {
                required: false,
                message: 'შეავსეთ პაროლი!',
              }
            ]}
            extra="Leave empty if you don't want to change the password"
        >
          <Input.Password/>
        </Form.Item>

        <Form.Item label={null}>
          <Button block type="primary" htmlType="submit" variant="solid" color="green">
            შენახვა
          </Button>
        </Form.Item>
      </ModalForm>
  );
};

export default EditOrganization;

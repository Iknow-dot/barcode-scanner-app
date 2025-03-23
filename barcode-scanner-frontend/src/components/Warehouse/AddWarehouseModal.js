import React, {useState} from 'react';
import api from '../../api';
import ModalForm from "../ModalForm";
import {Input, Form, Button} from "antd"; // Ensure you have an api setup for handling requests

const AddWarehouseModal = ({visible, setVisible, onFinish}) => {
  return (
      <ModalForm
          visible={visible}
          setVisible={setVisible}
          onFinish={onFinish}
          title="საწყობის დამატება"
      >
        <Form.Item
            label="სახელი:"
            name="name"
            rules={[
              {
                required: true,
                message: 'შეავსეთ სახელი!',
              },
            ]}
        >
            <Input/>
        </Form.Item>
        <Form.Item
            label="კოდი:"
            name="code"
            rules={[
              {
                required: true,
                message: 'შეავსეთ კოდი!',
              },
            ]}
        >
            <Input/>
        </Form.Item>
        <Form.Item>
          <Button block type="primary" htmlType="submit" variant="solid" color="green">
            დამატება
          </Button>
        </Form.Item>
      </ModalForm>
  );
};

export default AddWarehouseModal;

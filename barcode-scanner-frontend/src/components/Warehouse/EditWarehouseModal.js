import React, { useState, useEffect } from 'react';
import api from '../../api';
import ModalForm from "../ModalForm";
import {Button, Form, Input} from "antd";

const EditWarehouseModal = ({ visible, setVisible, onFinish, object }) => {
  return (
      <ModalForm
          object={object}
          visible={visible}
          setVisible={setVisible}
          onFinish={(data) => onFinish(data, object)}
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
            შენახვა
          </Button>
        </Form.Item>

      </ModalForm>
  );
};

export default EditWarehouseModal;

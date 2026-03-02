import React from 'react';
import ModalForm from "../ModalForm";
import {Input, Form, Button} from "antd";
import {useLanguage} from '../../i18n/LanguageContext';

const AddWarehouseModal = ({visible, setVisible, onFinish}) => {
  const {t} = useLanguage();

  return (
      <ModalForm
          visible={visible}
          setVisible={setVisible}
          onFinish={onFinish}
          title={t.addWarehouse}
      >
        <Form.Item
            label={t.warehouseName}
            name="name"
            rules={[
              {
                required: true,
                message: t.nameRequired,
              },
            ]}
        >
            <Input/>
        </Form.Item>
        <Form.Item
            label={t.warehouseCode}
            name="code"
            rules={[
              {
                required: true,
                message: t.codeRequired,
              },
            ]}
        >
            <Input/>
        </Form.Item>
        <Form.Item>
          <Button block type="primary" htmlType="submit" variant="solid" color="green">
            {t.add}
          </Button>
        </Form.Item>
      </ModalForm>
  );
};

export default AddWarehouseModal;

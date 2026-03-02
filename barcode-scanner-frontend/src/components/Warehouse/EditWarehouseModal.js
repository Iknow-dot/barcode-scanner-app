import React from 'react';
import ModalForm from "../ModalForm";
import {Button, Form, Input} from "antd";
import {useLanguage} from '../../i18n/LanguageContext';

const EditWarehouseModal = ({ visible, setVisible, onFinish, object }) => {
  const {t} = useLanguage();

  return (
      <ModalForm
          object={object}
          visible={visible}
          setVisible={setVisible}
          onFinish={(data) => onFinish(data, object)}
          title={t.editWarehouse}
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
            {t.save}
          </Button>
        </Form.Item>

      </ModalForm>
  );
};

export default EditWarehouseModal;

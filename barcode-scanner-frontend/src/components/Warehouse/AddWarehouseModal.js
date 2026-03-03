import React from 'react';
import ModalForm from "../ModalForm";
import {Input, Form, Button, Flex} from "antd";
import {PlusOutlined} from "@ant-design/icons";
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
        <Flex gap={16}>
          <Form.Item
              label={t.warehouseName}
              name="name"
              style={{flex: 1}}
              rules={[
                {
                  required: true,
                  message: t.nameRequired,
                },
              ]}
          >
              <Input placeholder={t.warehouseName}/>
          </Form.Item>
          <Form.Item
              label={t.warehouseCode}
              name="code"
              style={{flex: 1}}
              rules={[
                {
                  required: true,
                  message: t.codeRequired,
                },
              ]}
          >
              <Input placeholder={t.warehouseCode}/>
          </Form.Item>
        </Flex>
        <Form.Item style={{marginBottom: 0}}>
          <Button
              block
              type="primary"
              htmlType="submit"
              icon={<PlusOutlined/>}
              style={{height: 44, fontWeight: 600}}
          >
            {t.add}
          </Button>
        </Form.Item>
      </ModalForm>
  );
};

export default AddWarehouseModal;

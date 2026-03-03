import React from 'react';
import ModalForm, {useModalFormLoading} from "../ModalForm";
import {Input, Form, Button, Flex} from "antd";
import {PlusOutlined} from "@ant-design/icons";
import {useLanguage} from '../../i18n/LanguageContext';

const AddWarehouseForm = () => {
  const {t} = useLanguage();
  const {loading} = useModalFormLoading();

  return (
      <>
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
              loading={loading}
              icon={<PlusOutlined/>}
              style={{height: 44, fontWeight: 600}}
          >
            {t.add}
          </Button>
        </Form.Item>
      </>
  );
};

const AddWarehouseModal = ({visible, setVisible, onFinish}) => {
  const {t} = useLanguage();

  return (
      <ModalForm
          visible={visible}
          setVisible={setVisible}
          onFinish={onFinish}
          title={t.addWarehouse}
      >
        <AddWarehouseForm/>
      </ModalForm>
  );
};

export default AddWarehouseModal;

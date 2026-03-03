import React from 'react';
import ModalForm, {useModalFormLoading} from "../ModalForm";
import {Button, Flex, Form, Input} from "antd";
import {SaveOutlined} from "@ant-design/icons";
import {useLanguage} from '../../i18n/LanguageContext';

const EditWarehouseForm = () => {
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
              <Input/>
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
              <Input/>
          </Form.Item>
        </Flex>
        <Form.Item style={{marginBottom: 0}}>
          <Button
              block
              type="primary"
              htmlType="submit"
              loading={loading}
              icon={<SaveOutlined/>}
              style={{height: 44, fontWeight: 600}}
          >
            {t.save}
          </Button>
        </Form.Item>
      </>
  );
};

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
        <EditWarehouseForm/>
      </ModalForm>
  );
};

export default EditWarehouseModal;

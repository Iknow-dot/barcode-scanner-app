import {Form, Modal, Select, Space, Tag} from "antd";
import React, {useCallback, useEffect} from "react";

export const ModalForm = ({visible, setVisible, onFinish, title, name, object = null, children}) => {
  const [form] = Form.useForm();
  useEffect(() => {
    if (object && form) {
      form.resetFields();
      form.setFieldsValue(object);
    }
  }, [form, object]);
  return (
      <Modal open={visible} title={title} onCancel={() => setVisible(false)} footer={null}>
        <Form
            form={form}
            name={name}
            layout="vertical"
            style={{
              maxWidth: "none",
              width: "100%"
            }}
            onFinish={async (data) => {
              const ok = await onFinish(data)
              if (ok) {
                form.resetFields();
                setVisible(false);
              }
            }}
        >
          {children}
        </Form>
      </Modal>
  );
};

export const RenderOption = (option) => {
  return (
      <Space>
        <span role="img">
          {option.data?.emoji}
        </span>
        {option.data?.desc || option.data?.label}
      </Space>
  );
}

export const TagSelect = ({options, mode, placeholder, name, rules}) => {
  return (
      <Select
          mode={mode}
          placeholder={placeholder}
          name={name}
          rules={rules}
          options={options}
          optionRender={RenderOption}
          tagRender={(props) => (
              <Tag color='green'>
                {props.label}
              </Tag>
          )}
      />
  );
};

export default ModalForm;
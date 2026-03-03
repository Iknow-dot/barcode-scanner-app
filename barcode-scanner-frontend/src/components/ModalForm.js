import {Form, Modal, Select, Space, Tag} from "antd";
import React, {createContext, useContext, useEffect, useState} from "react";

const ModalFormContext = createContext({loading: false});

export const useModalFormLoading = () => useContext(ModalFormContext);

export const ModalForm = ({visible, setVisible, onFinish, title, name, object = null, children}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible && object && form) {
      form.resetFields();
      form.setFieldsValue(object);
    }
  }, [form, object, visible]);

  return (
      <Modal
          open={visible}
          title={title}
          onCancel={() => {
            if (!loading) setVisible(false);
          }}
          footer={null}
          destroyOnHidden
          centered
          closable={!loading}
          maskClosable={!loading}
          styles={{
            header: {
              paddingBottom: 12,
              borderBottom: '1px solid rgba(0, 0, 0, 0.06)',
              marginBottom: 0,
            },
            body: {
              paddingTop: 20,
            },
          }}
      >
        <ModalFormContext.Provider value={{loading}}>
          <Form
              form={form}
              name={name}
              layout="vertical"
              style={{
                maxWidth: "none",
                width: "100%"
              }}
              size="large"
              onFinish={async (data) => {
                setLoading(true);
                try {
                  const ok = await onFinish(data);
                  if (ok) {
                    form.resetFields();
                    setVisible(false);
                  }
                } finally {
                  setLoading(false);
                }
              }}
          >
            {children}
          </Form>
        </ModalFormContext.Provider>
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

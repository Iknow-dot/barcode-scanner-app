import {Form, Modal, Select, Space, Tag} from "antd";
import React, {useCallback} from "react";

export const ModalForm = ({visible, setVisible, onFinish, title, name, children}) => {
  return (
      <Modal open={visible} title={title} onCancel={() => setVisible(false)} footer={null}>
        <Form
            name={name}
            layout="vertical"
            style={{
              maxWidth: "none",
              width: "100%"
            }}
            initialValues={{
              remember: false,
            }}
            onFinish={(object) => {
              onFinish(object);
              setVisible(false);
            }}
            autoComplete="off"
        >
          {children}
        </Form>
      </Modal>
  );
};

export const TagSelect = ({options, mode, placeholder, name, label, rules}) => {
  const renderOption = useCallback((option) => {
    return (
        <Space>
        <span role="img">
          {option.data.emoji}
        </span>
          {option.data.desc}
        </Space>
    );
  }, []);
  return (
      <Select
          mode={mode}
          placeholder={placeholder}
          name={name}
          rules={rules}
          options={options}
          optionRender={renderOption}
          tagRender={(props) => (
              <Tag color='green'>
                {props.label}
              </Tag>
          )}
      />
  );
};

export default ModalForm;
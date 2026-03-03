import {Button, Flex, Popconfirm, Space, Table, Tooltip} from "antd";
import React, {useState} from "react";
import {CheckOutlined, CloseOutlined, DeleteOutlined, EditOutlined, PlusOutlined} from "@ant-design/icons";
import {useLanguage} from '../i18n/LanguageContext';

export const DataTab = ({
                          objects,
                          columns,
                          AddModal,
                          addModalExtraProps = {},
                          handleAdd,
                          EditModal,
                          handleEdit,
                          handleDelete,
                          loading = false,
                          ...props
                        }) => {
  const [editable, setEditable] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedObject, setSelectedObject] = useState({});
  const [deletingId, setDeletingId] = useState(null);
  const {t} = useLanguage();

  return (
      <div className="data-tab-wrapper">
        {<AddModal
            visible={addModalVisible}
            setVisible={setAddModalVisible}
            onFinish={handleAdd}
            {...addModalExtraProps}
        />}
        {<EditModal
            visible={editModalVisible}
            setVisible={setEditModalVisible}
            object={selectedObject}
            onFinish={handleEdit}
        />}

        <Flex justify="flex-end" style={{marginBottom: 16}} gap={8}>
          {editable ? (
              <>
                <Tooltip title={t.add}>
                  <Button
                      type="primary"
                      icon={<PlusOutlined/>}
                      onClick={() => setAddModalVisible(true)}
                      className="action-btn"
                  >
                    {t.add}
                  </Button>
                </Tooltip>
                <Tooltip title={t.close}>
                  <Button
                      icon={<CheckOutlined/>}
                      onClick={() => setEditable(false)}
                      className="action-btn"
                  />
                </Tooltip>
              </>
          ) : (
              <Tooltip title={t.editMode || 'Edit'}>
                <Button
                    type="default"
                    icon={<EditOutlined/>}
                    onClick={() => setEditable(true)}
                    className="action-btn"
                />
              </Tooltip>
          )}
        </Flex>

        <Table
            {...props}
            loading={loading}
            scroll={{x: "max-content"}}
            dataSource={objects.map(object => ({...object, key: object.id}))}
            size="middle"
            pagination={{
              size: 'default',
              showSizeChanger: objects.length > 10,
              showTotal: (total, range) => `${range[0]}-${range[1]} / ${total}`,
            }}
            columns={[
              ...columns,
              ...(editable ? [{
                key: "actions",
                title: '',
                width: 100,
                align: "right",
                render: (_, object) => (
                    <Space size={4}>
                      <Tooltip title={t.editMode || 'Edit'}>
                        <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined/>}
                            onClick={() => {
                              setSelectedObject(object);
                              setEditModalVisible(true);
                            }}
                            className="action-btn"
                            style={{color: '#1677ff'}}
                        />
                      </Tooltip>
                      <Popconfirm
                          title={t.confirmDelete}
                          onConfirm={async () => {
                            setDeletingId(object.id);
                            try {
                              await handleDelete(object);
                            } finally {
                              setDeletingId(null);
                            }
                          }}
                          okText={t.yes}
                          cancelText={t.no}
                          okButtonProps={{danger: true}}
                          cancelButtonProps={{type: 'primary'}}
                      >
                        <Tooltip title={t.delete}>
                          <Button
                              type="text"
                              size="small"
                              danger
                              loading={deletingId === object.id}
                              icon={<DeleteOutlined/>}
                              className="action-btn"
                          />
                        </Tooltip>
                      </Popconfirm>
                    </Space>
                ),
              }] : []),
            ]}
        />
      </div>
  );
};

export default DataTab;

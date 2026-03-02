import {Button, Popconfirm, Space, Table} from "antd";
import React, {useState} from "react";
import {CheckOutlined, DeleteOutlined, EditOutlined, PlusOutlined} from "@ant-design/icons";
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
                          ...props
                        }) => {
  const [editable, setEditable] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedObject, setSelectedObject] = useState({});
  const {t} = useLanguage();

  return (
      <div>
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

        <Table
            {...props}
            scroll={{x: "max-content"}}
            dataSource={objects.map(object => ({...object, key: object.id}))}
            columns={[
              ...columns,
              {
                key: "x",
                title: (
                    <>
                      {editable ? (
                          <Space>
                            <Button variant="outlined" color="green" onClick={() => setAddModalVisible(true)}>
                              <PlusOutlined/>
                            </Button>
                            <Button variant="outlined" color="primary" onClick={() => setEditable(false)}>
                              <CheckOutlined/>
                            </Button>
                          </Space>
                      ) : (
                          <Button variant="outlined" color="primary" onClick={() => setEditable(true)}>
                            <EditOutlined/>
                          </Button>
                      )}
                    </>
                ),
                align: "right",
                render: (_, object) => (
                    <>
                      {editable && (
                          <Space>
                            <Button variant="outlined" color="primary" onClick={() => {
                              setSelectedObject(object);
                              setEditModalVisible(true);
                            }}>
                              <EditOutlined/>
                            </Button>
                            <Popconfirm
                                title={t.confirmDelete}
                                onConfirm={() => handleDelete(object)}
                                okText={t.yes}
                                cancelText={t.no}
                                okButtonProps={{
                                  danger: true
                                }}
                                cancelButtonProps={{
                                  type: 'primary'
                                }}
                            >
                              <Button danger>
                                <DeleteOutlined/>
                              </Button>
                            </Popconfirm>
                          </Space>
                      )}
                    </>
                ),
              },
            ]}
        />
      </div>
  );
};

export default DataTab;

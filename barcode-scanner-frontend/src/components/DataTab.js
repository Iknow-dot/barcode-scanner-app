import {Button, Popconfirm, Space, Table} from "antd";
import React, {useState} from "react";
import {DeleteOutlined, EditOutlined, PlusOutlined} from "@ant-design/icons";

export const DataTab = ({
                          objects,
                          columns,
                          AddModal,
                          addModalExtraProps = {},
                          handleAdd,
                          EditModal,
                          handleEdit,
                          handleDelete
                        }) => {
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedObject, setSelectedObject] = useState({});

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
            dataSource={objects}
            columns={[
              ...columns,
              {
                key: "x",
                title: (
                    <>
                      <Button variant="outlined" color="green" onClick={() => setAddModalVisible(true)}>
                        <PlusOutlined/>
                      </Button>
                    </>
                ),
                align: "right",
                render: (_, object) => (
                    <Space size="middle">
                      <Button variant="outlined" color="primary" onClick={() => {
                        console.log("Changing object to", object);
                        setSelectedObject(object);
                        setEditModalVisible(true);
                      }}>
                        <EditOutlined/>
                      </Button>
                      <Popconfirm
                          title={`გსურთ წაშლა?`}
                          onConfirm={() => handleDelete(object)}
                          okText="დიახ"
                          cancelText="არა"
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
                ),
              },
            ]}
        />
      </div>
  );
};

export default DataTab;
import React, {useState, useEffect} from 'react';
import api from '../../api';
import {Button, Space, Table} from "antd";
import {DeleteOutlined, EditOutlined, PlusOutlined} from "@ant-design/icons";

const WarehousesTab = ({warehouses: initialWarehouses, openModal}) => {
  const [warehouses, setWarehouses] = useState(initialWarehouses);
  const [organizations, setOrganizations] = useState({});

  useEffect(() => {
    const fetchOrganizations = async () => {
      try {
        const response = await api.get('/organizations');
        const orgMap = response.data.reduce((acc, org) => {
          acc[org.id] = org.name;
          return acc;
        }, {});
        setOrganizations(orgMap);
      } catch (error) {
        console.error('Error fetching organizations:', error);
      }
    };
    fetchOrganizations();
  }, []);

  const handleEdit = (warehouse) => {
    openModal('editWarehouse', warehouse);
  };

  const handleDelete = async (warehouseId) => {
    if (window.confirm("ნამდვილად გსურთ ამ საწყობის წაშლა?")) {
      try {
        await api.delete(`/warehouses/${warehouseId}`);
        setWarehouses(currentWarehouses => currentWarehouses.filter(wh => wh.id !== warehouseId));
      } catch (error) {
        console.error("საწყობის წაშლის შეცდომა:", error);
      }
    }
  };

  return (
      <div id="Warehouses" className="tab-content active">
        <Table
            dataSource={warehouses.map(wh => ({...wh, key: wh.id}))}
            columns={[
              {key: "name", title: 'სახელი', dataIndex: 'name'},
              {
                key: "organization_id",
                title: 'ორგანიზაცია',
                dataIndex: 'organization_id',
                render: (orgId) => organizations[orgId] || 'N/A'
              },
              {
                key: "x",
                title: (
                    <Button variant="outlined" color="green" onClick={() => openModal('addWarehouse')}>
                      <PlusOutlined/>
                    </Button>
                ),
                align: "right",
                render: (wh) => (
                    <Space size="middle">
                      <Button variant="outlined" color="primary" onClick={() => handleEdit(wh)}>
                        <EditOutlined/>
                      </Button>
                      <Button variant="outlined" color="danger" onClick={() => handleDelete(wh.id)}>
                        <DeleteOutlined/>
                      </Button>
                    </Space>
                )
              }
            ]}
        />
      </div>
  );
};

export default WarehousesTab;

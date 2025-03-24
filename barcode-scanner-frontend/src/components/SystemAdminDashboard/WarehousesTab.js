import React, {useState, useEffect} from 'react';
import api from '../../api';
import {notification} from "antd";
import DataTab from "../DataTab";
import AddWarehouseModal from "../Warehouse/AddWarehouseModal";
import EditWarehouseModal from "../Warehouse/EditWarehouseModal";

const WarehousesTab = ({}) => {
  const [warehouses, setWarehouses] = useState([]);
  const [organizations, setOrganizations] = useState({});
  const [notificationApi, contextHolder] = notification.useNotification();
  const [notificationData, setNotificationData] = useState({});

  const openNotificationWithIcon = (type, message, description) => {
    notificationApi[type]({
      message, description, showProgress: true, pauseOnHover: true,
    });
  };
  useEffect(() => {
    if (notificationData.message) {
      openNotificationWithIcon(
          notificationData.type,
          notificationData.message,
          notificationData.description
      );
    }
  }, [notificationData]);


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

    const fetchWarehouses = async () => {
      const response = await api.get('/warehouses');
      setWarehouses(response.data);
    }
    fetchOrganizations();
    fetchWarehouses();
  }, []);

  const handleDelete = async (warehouse) => {
    try {
      await api.delete(`/warehouses/${warehouse.id}`);
      setWarehouses(currentWarehouses => currentWarehouses.filter(wh => wh.id !== warehouse.id));
      setNotificationData({
        type: 'success',
        message: 'საწყობის წაშლა',
        description: `საწყობი: ${warehouse.name} წაიშლა`
      });
    } catch (error) {
      setNotificationData({
        type: 'error',
        message: 'საწყობის წაშლა',
        description: error.message
      });
    }
  };

  const handleEditWarehouse = async (updateWarehouse, originalWarehouse) => {
    try {
      updateWarehouse = {...originalWarehouse, ...updateWarehouse};
      await api.put(`/warehouses/${updateWarehouse.id}`, updateWarehouse);
      setWarehouses((prevWarehouses) => prevWarehouses.map(wh => wh.id === updateWarehouse.id ? updateWarehouse : wh));
      setNotificationData({
        type: 'success',
        message: 'საწყობის შეცვლა',
        description: `საწყობი: ${updateWarehouse.name} შეცვლილია`
      });
      return true;
    } catch (error) {
      setNotificationData({
        type: 'error',
        message: 'საწყობის შეცვლა',
        description: error.message
      })
      return false;
    }
  };

  const handleAddWarehouse = async (newWarehouseData) => {
    try {
      await api.post('/warehouses', newWarehouseData);
      const whRes = await api.get('/warehouses');
      setWarehouses(whRes.data);
    } catch (error) {
      console.error('საწყობის დამატების შეცდომა', error);
    }
  };

  return (
      <>
        {contextHolder}
        <DataTab
            objects={warehouses}
            columns={[
              {key: "name", title: 'სახელი', dataIndex: 'name'},
              {
                key: "organization_id",
                title: 'ორგანიზაცია',
                dataIndex: 'organization_id',
                render: (orgId) => organizations[orgId] || 'N/A'
              }
            ]}
            AddModal={AddWarehouseModal}
            handleAdd={handleAddWarehouse}
            EditModal={EditWarehouseModal}
            handleEdit={handleEditWarehouse}
            handleDelete={handleDelete}
        />
      </>
  );
};

export default WarehousesTab;

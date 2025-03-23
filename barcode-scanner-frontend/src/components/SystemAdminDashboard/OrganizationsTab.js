import React, {useEffect, useState} from 'react';
import api from '../../api';
import DataTab from "../DataTab";
import AddOrganization from "../Organization/AddOrganization";
import EditOrganization from "../Organization/EditOrganization";
import {notification} from "antd";

const OrganizationsTab = () => {
  const [organizations, setOrganizations] = useState([]);

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
    const fetchData = async () => {
      const response = await api.get('/organizations');
      setOrganizations(response.data);
    }
    fetchData();
  }, []);

  const handleDelete = async (organization) => {
    try {
      await api.delete(`/organizations/${organization.id}`);
      setOrganizations(organizations.filter(org => org.id !== organization.id));
      setNotificationData({
        type: 'warning',
        message: 'ორგანიზაცია წაიშლა',
        description: `ორგანიზაცია: ${organization.name}`
      })

    } catch (error) {
      setNotificationData({
        type: 'error',
        message: 'შეცდომა ორგანიზაციის წაშლისას:',
        description: error.response?.data?.error || error.message
      });
    }
  };

  const handleAddOrganization = async (newOrganizationData) => {
    try {
      const response = await api.post('/organizations', newOrganizationData);

      if (response.status === 201) {
        setNotificationData({
          type: 'success',
          message: 'ორგანიზაცია წარმატებით შეიქმნა!',
          description: `ორგანიზაცია: ${newOrganizationData.name}`
        });
        setOrganizations([...organizations, newOrganizationData]);
        return true;
      }
    } catch (error) {
      setNotificationData({
        type: 'error',
        message: 'შეცდომა ორგანიზაციის შექმნისას:',
        description: error.response?.data?.error || error.message
      });
      return false;
    }
  }

  const handleEditOrganization = async (updatedOrganizationData, originalOrganization) => {
    try {
      const updatedOrgData = {
        ...originalOrganization,
        ...updatedOrganizationData
      }
      await api.put(`/organizations/${updatedOrgData.id}`, updatedOrgData);
      const orgRes = await api.get('/organizations');
      setOrganizations(orgRes.data);
      setNotificationData({
        type: 'success',
        message: 'ორგანიზაცია წარმატებიით შეირედაქტირდა',
        description: `ორგანიზაცია: ${updatedOrgData.name}`
      });
      return true;
    } catch (error) {
      setNotificationData({
        type: 'error',
        message: 'შეცდომა ორგანიზაციის რედაქტირებისას:',
        description: error.response?.data?.error || error.message
      });
      return false;
    }
  }

  return (
      <>
        {contextHolder}
        <DataTab
            objects={organizations}
            columns={[
              {key: "name", title: 'ორგანიზაცია', dataIndex: 'name'},
              {key: "identification_code", title: 'გსნ', dataIndex: 'identification_code'},
              {key: "employees_count", title: 'თანამშრომელთა რაოდენობა', dataIndex: 'employees_count'},
            ]}
            AddModal={AddOrganization}
            handleAdd={handleAddOrganization}
            EditModal={EditOrganization}
            handleEdit={handleEditOrganization}
            handleDelete={handleDelete}
        />
      </>
  );
};

export default OrganizationsTab;

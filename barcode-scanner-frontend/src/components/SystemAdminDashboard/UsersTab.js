import React, {useContext, useEffect, useState} from 'react';
import api from '../../api';
import {notification, Tag} from "antd";
import DataTab from "../DataTab";
import AuthContext from "../Auth/AuthContext";


const UsersTab = ({users: initialUsers, AddModal, EditModal, addModalExtraProps}) => {
  const {authData} = useContext(AuthContext);
  const [users, setUsers] = useState(initialUsers);
  const [organizations, setOrganizations] = useState({});
  const [notificationApi, contextHolder] = notification.useNotification();
  const [notificationData, setNotificationData] = useState({});

  const openNotificationWithIcon = (type, message, description) => {
    notificationApi[type]({
      message, description, showProgress: true, pauseOnHover: true,
    });
  };
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

  useEffect(() => {
    setUsers(initialUsers);
  }, [initialUsers]);

  useEffect(() => {
    if (notificationData.message) {
      openNotificationWithIcon(
          notificationData.type,
          notificationData.message,
          notificationData.description
      );
    }
  }, [notificationData]);


  const handleAdd = async (newUser) => {
    if (authData?.role === 'admin') {
      newUser.organization_id = authData.organization_id; // Admin's organization
      newUser.role_name = 'user'; // Admin adds users with the role 'user'
    }
    try {
      newUser["ip_address"] = newUser["ip_address"].join(", ");
      // Make the API call to create the user
      const response = await api.post('/users', newUser, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.status === 201) {
        const {id} = response.data;
        newUser.id = id;
        setNotificationData({
          type: 'success',
          message: 'წარმატება',
          description: `მომხმარებელი "${newUser.username}" წარმატებიით შეიქმნა`
        })
        setUsers(prevUsers => [...prevUsers, newUser]);
        return true;
      }
    } catch (error) {
      console.error('შეცდომა მომხმარებლის შექმნისას:', error.response?.data?.error || error.message);
      setNotificationData({
        type: 'error',
        message: 'შეცდომა',
        description: `მომხმარებლის შექმნისას შეცდომა "(${error.response?.data?.error || error.message})"`
      });
      return false;
    }
  }

  const handleDelete = async (deleteUser) => {
    try {
      await api.delete(`/users/${deleteUser.id}`);
      setUsers(prevUsers => prevUsers.filter(user => user.id !== deleteUser.id));
      setNotificationData({
        type: 'success',
        message: 'წარმატება',
        description: `"${deleteUser.username}" წარმატებიით წაიშალა`
      });

    } catch (error) {
      setNotificationData({
        type: 'error',
        message: 'შეცდომა',
        description: `მომხმარებლის წაშლისას შეცდომა "(${error.response?.data?.error || error.message})"`
      })
    }
  };

  const handleEdit = async (modifiedFields, editUser) => {
    console.log(modifiedFields, editUser);
    try {
      editUser = {...editUser, ...modifiedFields};
      if (editUser.ip_address !== "") {
        editUser.ip_address = editUser.ip_address.join(", ");
      } else {
        editUser.ip_address = null;
      }
      console.log(editUser);
      await api.put(`/users/${editUser.id}`, editUser);
      setUsers(prevUsers => prevUsers.map(user => user.id === editUser.id ? editUser : user));
      setNotificationData({
        type: 'success',
        message: 'წარმატება',
        description: `მომხმარებელი "${editUser.username}" წარმატებიით განახლდა`
      });
      return true;
    } catch (error) {
      setNotificationData({
        type: 'error',
        message: 'შეცდომა',
        description: `მომხმარებლის "${editUser.username}" განახლებისას შეცდომა "(${error.response?.data?.error || error.message})"`
      });
      return false;
    }
  };

  return (
      <>
        {contextHolder}
        <DataTab
            objects={users}
            columns={[
              {key: "username", title: 'სახელი', dataIndex: 'username'},
              {
                key: "organization_id",
                title: 'ორგანიზაცია',
                dataIndex: 'organization_id',
                render: (orgId) => organizations[orgId] || 'N/A'
              },
              {
                key: "role_name", title: 'როლი', dataIndex: 'role_name', render: (role) => (
                    <Tag color="geekblue">{role}</Tag>
                )
              },
            ]}
            AddModal={AddModal}
            handleAdd={handleAdd}
            addModalExtraProps={addModalExtraProps}
            EditModal={EditModal}
            handleEdit={handleEdit}
            handleDelete={handleDelete}
        />
      </>

  );
};

export default UsersTab;

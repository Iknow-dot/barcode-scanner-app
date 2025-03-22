import React, { useEffect, useState } from 'react';
import api from '../../api';
import {UserAddOutlined} from "@ant-design/icons";
import {Button, Table, Tag} from "antd";

const UsersTab = ({ users: initialUsers, openModal }) => {
  const [users, setUsers] = useState(initialUsers);
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

  useEffect(() => {
    setUsers(initialUsers);
  }, [initialUsers]);

  const handleEdit = (user) => {
    openModal('editUser', user);
  };

  const handleDelete = async (userId) => {
    if (window.confirm("ნამდვილად გსურთ ამ მომხმარებლის წაშლა?")) {
      try {
        await api.delete(`/users/${userId}`);
        setUsers(prevUsers => prevUsers.filter(user => user.id !== userId));
      } catch (error) {
        console.error("მომხმარებლის წაშლის შეცდომა:", error);
      }
    }
  };

  return (
    <div>
      <Button variant="solid" color="green" onClick={() => openModal('user')}>
        <UserAddOutlined /> მომხმარებლის დამატება
      </Button>

      <Table
        dataSource={users}
        columns={[
            { title: 'სახელი', dataIndex: 'username' },
            { title: 'ორგანიზაცია', dataIndex: 'organization_id', render: (orgId) => organizations[orgId] || 'N/A' },
            { title: 'როლი', dataIndex: 'role_name', render: (role) => (
                <Tag color="geekblue">{role}</Tag>
              ) },
            {
                title: 'ქმედებები',
                render: (_, user) => (
                <>
                    <Button variant="outlined" color="primary" onClick={() => handleEdit(user)}>რედაქტირება</Button>
                    <Button variant="outlined" color="danger" onClick={() => handleDelete(user.id)}>წაშლა</Button>
                </>
                ),
            },
        ]}
      />
    </div>
  );
};

export default UsersTab;

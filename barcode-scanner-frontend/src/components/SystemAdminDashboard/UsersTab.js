import React, { useEffect, useState } from 'react';
import api from '../../api';

const UsersTab = ({ users, openModal }) => {
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

  const handleEdit = (user) => {
    openModal('editUser', user);
  };

  const handleDelete = async (userId) => {
    if (window.confirm("ნამდვილად გსურთ ამ მომხმარებლის წაშლა?")) {
      try {
        await api.delete(`/users/${userId}`);
        window.location.reload();
      } catch (error) {
        console.error("მომხმარებლის წაშლის შეცდომა:", error);
      }
    }
  };

  return (
    <div id="Users" className="tab-content active">
      <button className="add-btn" onClick={() => openModal('user')}>
        მომხმარებლის დამატება
      </button>
      <table>
        <thead>
          <tr>
            <th>სახელი</th>
            <th>ორგანიზაცია</th>
            <th>როლი</th>
            <th>ქმედებები</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            // console.log("User role data:", user); // Logs role data for debugging
            return (
              <tr key={user.id}>
                <td>{user.username}</td>
                <td>{organizations[user.organization_id] || 'N/A'}</td>
                <td>{user.role_name || 'N/A'}</td>
                <td>
                  <button className="edit-btn" onClick={() => handleEdit(user)}>
                    რედაქტირება
                  </button>
                  <button className="delete-btn" onClick={() => handleDelete(user.id)}>
                    წაშლა
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default UsersTab;

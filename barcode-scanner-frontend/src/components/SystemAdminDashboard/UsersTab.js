import React from 'react';

const UsersTab = ({ users, isModalOpen, openModal, closeModal }) => (
  <div id="Users" className="tab-content active">
    <button className="add-btn" onClick={() => openModal('userModal')}>
      მომხმარებლის დამატება
    </button>
    <table>
      <thead>
        <tr>
          <th>სახელი</th>
          <th>Email</th>
          <th>ორგანიზაცია</th>
          <th>როლი</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {users.map((user) => (
          <tr key={user.id}>
            <td>{user.username}</td>
            <td>{user.email}</td>
            <td>{user.organization_id}</td>
            <td>{user.role}</td>
            <td>Actions here</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default UsersTab;

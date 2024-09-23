import React from 'react';
import { Link } from 'react-router-dom';

const UserList = ({ users, onDelete }) => {
  return (
    <div>
      <h1>Users</h1>
      <Link to="/add-user" className="button add-button">Add New User</Link>
      <ul className="user-list">
        {users.map(user => (
          <li key={user.id} className="user-item">
            <span>{user.username}</span>
            <div className="actions">
              <Link to={`/edit-user/${user.id}`} className="button edit-button">Edit</Link>
              <button onClick={() => onDelete(user.id)} className="button delete-button">Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default UserList;

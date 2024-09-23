import React from 'react';
import { Link } from 'react-router-dom';

const OrganizationList = ({ organizations, onDelete }) => {
  return (
    <div>
      <h1>Organizations</h1>
      <Link to="/add-organization" className="button add-button">Add New Organization</Link>
      <ul className="organization-list">
        {organizations.map(org => (
          <li key={org.id} className="organization-item">
            <span>{org.name}</span>
            <div className="actions">
              <Link to={`/edit-organization/${org.id}`} className="button edit-button">Edit</Link>
              <button onClick={() => onDelete(org.id)} className="button delete-button">Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default OrganizationList;

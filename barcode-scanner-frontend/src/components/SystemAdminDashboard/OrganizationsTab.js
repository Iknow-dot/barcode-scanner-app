import React from 'react';
import api from '../../api';

const OrganizationsTab = ({ organizations, openModal }) => {
  const handleEdit = (org) => {
    openModal('edit', org); // Pass 'edit' mode and organization data to the modal
  };

  const handleDelete = async (orgId) => {
    if (window.confirm("Are you sure you want to delete this organization?")) {
      try {
        await api.delete(`/organizations/${orgId}`);
        window.location.reload(); // Reload to refresh the organization list
      } catch (error) {
        console.error("Error deleting organization:", error);
      }
    }
  };

  return (
    <div id="Organizations" className="tab-content active">
      <button className="add-btn" onClick={() => openModal('organization')}>ორგანიზაციის დამატება</button>
      <table>
        <thead>
          <tr>
            <th>ორგანიზაცია</th>
            <th>გსნ</th>
            <th>თანამშრომელთა რაოდენობა</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {organizations.map((org) => (
            <tr key={org.id}>
              <td>{org.name}</td>
              <td>{org.identification_code}</td>
              <td>{org.employees_count}</td>
              <td>
                <button
                  className="edit-btn"
                  onClick={() => handleEdit(org)} // Call handleEdit with the organization data
                >
                  Edit
                </button>
                <button
                  className="delete-btn"
                  onClick={() => handleDelete(org.id)}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default OrganizationsTab;

import React from 'react';

const OrganizationsTab = ({ organizations, openModal }) => (
  <div id="Organizations" className="tab-content active">
    <button className="add-btn" onClick={openModal}>
      ორგანიზაციის დამატება
    </button>
    <table>
      <thead>
        <tr>
          <th>ორგანიზაცია</th>
          <th>გსნ</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {organizations.map((org) => (
          <tr key={org.id}>
            <td>{org.name}</td>
            <td>{org.identification_code}</td>
            <td>Actions here</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default OrganizationsTab;

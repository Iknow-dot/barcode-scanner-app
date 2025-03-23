import React from 'react';
import api from '../../api';
import {Button, Space, Table} from "antd";
import {DeleteOutlined, EditOutlined, PlusOutlined} from "@ant-design/icons";
import DataTab from "../DataTab";
import AddOrganization from "../Organization/AddOrganization";
import EditOrganization from "../Organization/EditOrganization";

const OrganizationsTab = ({organizations, openModal}) => {
  const handleEdit = (org) => {
    openModal('edit', org); // Pass 'edit' mode and organization data to the modal
  };

  const handleDelete = async (orgId) => {
    if (window.confirm("ნამდვილად გსურთ ორგანიზაციის წაშლა?")) {
      try {
        await api.delete(`/organizations/${orgId}`);
        window.location.reload(); // Reload to refresh the organization list
      } catch (error) {
        console.error("ორგანიზაციის წაშლის შეცდომა:", error);
      }
    }
  };

  const handleAddOrganization = async (newOrganizationData) => {

  }

  const handleEditOrganization = async (updatedOrganizationData) => {

  }

  return (
      <>

        <div id="Organizations" className="tab-content active">
          <Table
              dataSource={organizations}
              columns={[
                {key: "name", title: 'ორგანიზაცია', dataIndex: 'name'},
                {key: "identification_code", title: 'გსნ', dataIndex: 'identification_code'},
                {key: "employees_count", title: 'თანამშრომელთა რაოდენობა', dataIndex: 'employees_count'},
                {
                  key: "actions",
                  title: (
                      <Button variant="outlined" color="green" onClick={() => openModal('organization')}>
                        <PlusOutlined/>
                      </Button>
                  ),
                  align: "right",
                  render: (org) => (
                      <Space size="middle">
                        <Button variant="outlined"
                                color="primary"
                                onClick={() => handleEdit(org)}>
                          <EditOutlined/>
                        </Button>
                        <Button variant="outlined" color="danger" onClick={() => handleDelete(org.id)}>
                          <DeleteOutlined/>
                        </Button>
                      </Space>
                  ),
                },
              ]}
          />
        </div>
      </>
  );
};

export default OrganizationsTab;

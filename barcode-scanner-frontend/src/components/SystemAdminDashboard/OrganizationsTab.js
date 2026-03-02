import React, {useEffect, useState} from 'react';
import {organizationService} from '../../api';
import DataTab from "../DataTab";
import AddOrganization from "../Organization/AddOrganization";
import EditOrganization from "../Organization/EditOrganization";
import UsersTab from "./UsersTab";
import useAppNotification from "../../hooks/useAppNotification";

const OrganizationsTab = () => {
    const [organizations, setOrganizations] = useState([]);
    const {notify, contextHolder} = useAppNotification();

    useEffect(() => {
        const fetchData = async () => {
            const result = await organizationService.getOrganizations();
            if (result.success) {
                setOrganizations(result.data || []);
            } else {
                notify.error(
                    'შეცდომა ორგანიზაციების მიღებისას, შეამოწმეთ ინტერნეტთან კავშირი',
                    result.error
                );
            }
        };
        fetchData();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleDelete = async (organization) => {
        const result = await organizationService.deleteOrganization(organization.id);

        if (result.success) {
            setOrganizations(organizations.filter(org => org.id !== organization.id));
            notify.warning('ორგანიზაცია წაიშლა', `ორგანიზაცია: ${organization.name}`);
        } else {
            notify.error('შეცდომა ორგანიზაციის წაშლისას:', result.error);
        }
    };

    const handleAddOrganization = async (newOrganizationData) => {
        const payload = {
            name: newOrganizationData.name,
            identification_number: newOrganizationData.identification_number,
            employees_count: newOrganizationData.employees_count,
            web_service_url: newOrganizationData.web_service_url,
            web_service_username: newOrganizationData.web_service_username,
            web_service_password: newOrganizationData.web_service_password,
        };

        const result = await organizationService.createOrganization(payload);

        if (result.success) {
            notify.success('ორგანიზაცია წარმატებით შეიქმნა!', `ორგანიზაცია: ${newOrganizationData.name}`);
            setOrganizations([...organizations, result.data]);
            return true;
        }

        notify.error('შეცდომა ორგანიზაციის შექმნისას:', result.error);
        return false;
    };

    const handleEditOrganization = async (updatedOrganizationData, originalOrganization) => {
        const payload = {
            ...originalOrganization,
            ...updatedOrganizationData,
        };

        // If password field is empty, remove it so Django doesn't overwrite with empty
        if (!payload.web_service_password) {
            delete payload.web_service_password;
        }

        const result = await organizationService.updateOrganization(originalOrganization.id, payload);

        if (result.success) {
            // Refresh full list from server to get updated data
            const refreshResult = await organizationService.getOrganizations();
            if (refreshResult.success) {
                setOrganizations(refreshResult.data);
            }
            notify.success('ორგანიზაცია წარმატებიით შეირედაქტირდ��', `ორგანიზაცია: ${payload.name}`);
            return true;
        }

        notify.error('შეცდომა ორგანიზაციის რედაქტირებისას:', result.error);
        return false;
    };

    return (
        <>
            {contextHolder}
            <DataTab
                objects={organizations}
                columns={[
                    {key: "name", title: 'ორგანიზაცია', dataIndex: 'name'},
                    {key: "identification_number", title: 'გსნ', dataIndex: 'identification_number'},
                    {key: "employees_count", title: 'თანამშრომელთა რაოდენობა', dataIndex: 'employees_count'},
                ]}
                AddModal={AddOrganization}
                handleAdd={handleAddOrganization}
                EditModal={EditOrganization}
                handleEdit={handleEditOrganization}
                handleDelete={handleDelete}
                expandedRowRender={(organization) => (
                    <UsersTab
                        initialUsers={organization.users}
                        handleEditCallback={(user, modifiedFields, editUser) => {
                            const org = organizations.find(o => o.id === user.organization);
                            if (!org) return;
                            const updatedUsers = [
                                ...org.users.filter(u => u.id !== user.id),
                                user
                            ];

                            setOrganizations(organizations.map(o => {
                                if (o.id === user.organization) {
                                    return {...o, users: updatedUsers};
                                }
                                return o;
                            }));
                        }}
                        addModalExtraProps={{
                            organization
                        }}
                    />
                )}
            />
        </>
    );
};

export default OrganizationsTab;

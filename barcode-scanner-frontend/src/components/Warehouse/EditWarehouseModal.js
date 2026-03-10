import React, {useState, useEffect, useContext} from 'react';
import ModalForm, {RenderOption, useModalFormLoading} from "../ModalForm";
import {Button, Divider, Flex, Form, Input, Select, Tag} from "antd";
import {SaveOutlined} from "@ant-design/icons";
import {useLanguage} from '../../i18n/LanguageContext';
import {userService, organizationService} from '../../api';
import AuthContext from '../Auth/AuthContext';

const EditWarehouseForm = ({object}) => {
    const {t} = useLanguage();
    const {loading} = useModalFormLoading();
    const {authData} = useContext(AuthContext);
    const isCompanyAdmin = authData?.role === 'company_admin';
    const isInternalAdmin = authData?.role === 'internal_admin';

    const [users, setUsers] = useState([]);
    const [organizations, setOrganizations] = useState([]);
    const [allUsers, setAllUsers] = useState([]);
    const orgId = object?.organization;

    useEffect(() => {
        const fetchData = async () => {
            if (isInternalAdmin) {
                const orgResult = await organizationService.getOrganizations();
                if (orgResult.success) {
                    setOrganizations(orgResult.data || []);
                }
                const userResult = await userService.getUsers();
                if (userResult.success) {
                    const all = userResult.data || [];
                    setAllUsers(all);
                    // Filter users by the warehouse's organization
                    if (orgId) {
                        setUsers(all.filter(u => u.organization === orgId));
                    }
                }
            } else if (isCompanyAdmin) {
                const result = await userService.getUsers();
                if (result.success) {
                    setUsers(result.data || []);
                }
            }
        };
        fetchData();
    }, [isInternalAdmin, isCompanyAdmin, orgId]);

    // Re-filter users when organization changes (for internal_admin editing)
    const handleOrgChange = (value) => {
        if (isInternalAdmin) {
            setUsers(allUsers.filter(u => u.organization === value));
        }
    };

    return (
        <>
            <Flex gap={16}>
                <Form.Item
                    label={t.warehouseName}
                    name="name"
                    style={{flex: 1}}
                    rules={[
                        {
                            required: true,
                            message: t.nameRequired,
                        },
                    ]}
                >
                    <Input/>
                </Form.Item>
                <Form.Item
                    label={t.warehouseCode}
                    name="code"
                    style={{flex: 1}}
                    rules={[
                        {
                            required: true,
                            message: t.codeRequired,
                        },
                    ]}
                >
                    <Input/>
                </Form.Item>
            </Flex>

            {isInternalAdmin && (
                <Form.Item
                    label={t.organization}
                    name="organization"
                    rules={[{required: true, message: t.orgRequired}]}
                >
                    <Select
                        options={organizations.map(org => ({
                            label: org.name,
                            value: org.id,
                            emoji: '🏢',
                            desc: org.name
                        }))}
                        placeholder={t.selectOrganization}
                        optionRender={RenderOption}
                        filterOption={(input, option) =>
                            option?.label.toLowerCase().includes(input.toLowerCase())
                        }
                        showSearch
                        onChange={handleOrgChange}
                    />
                </Form.Item>
            )}

            <Divider style={{margin: '4px 0 16px'}} dashed/>

            <Form.Item
                label={t.users}
                name="user_ids"
                rules={[{required: false}]}
            >
                <Select
                    mode="multiple"
                    options={users.map(u => ({
                        label: u.username + (u.first_name || u.last_name ? ` (${[u.first_name, u.last_name].filter(Boolean).join(' ')})` : ''),
                        value: u.id,
                        emoji: '👤',
                        desc: u.username + (u.first_name || u.last_name ? ` (${[u.first_name, u.last_name].filter(Boolean).join(' ')})` : ''),
                    }))}
                    placeholder={t.selectUsers}
                    optionRender={RenderOption}
                    tagRender={(props) => (
                        <Tag color='blue'>{props.label}</Tag>
                    )}
                    filterOption={(input, option) =>
                        option?.label.toLowerCase().includes(input.toLowerCase())
                    }
                />
            </Form.Item>

            <Form.Item style={{marginBottom: 0}}>
                <Button
                    block
                    type="primary"
                    htmlType="submit"
                    loading={loading}
                    icon={<SaveOutlined/>}
                    style={{height: 44, fontWeight: 600}}
                >
                    {t.save}
                </Button>
            </Form.Item>
        </>
    );
};

const EditWarehouseModal = ({visible, setVisible, onFinish, object}) => {
    const {t} = useLanguage();

    // Map user_ids_read to user_ids for the form initial values
    const formObject = object ? {
        ...object,
        user_ids: object.user_ids_read || [],
    } : object;

    return (
        <ModalForm
            object={formObject}
            visible={visible}
            setVisible={setVisible}
            onFinish={(data) => onFinish(data, object)}
            title={t.editWarehouse}
        >
            <EditWarehouseForm object={object}/>
        </ModalForm>
    );
};

export default EditWarehouseModal;

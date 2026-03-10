import React, {useState, useEffect, useContext} from 'react';
import ModalForm, {RenderOption, useModalFormLoading} from "../ModalForm";
import {Input, Form, Button, Flex, Select, Tag, Divider} from "antd";
import {PlusOutlined} from "@ant-design/icons";
import {useLanguage} from '../../i18n/LanguageContext';
import {userService, organizationService} from '../../api';
import AuthContext from '../Auth/AuthContext';

const AddWarehouseForm = ({organization = null}) => {
    const {t} = useLanguage();
    const {loading} = useModalFormLoading();
    const {authData} = useContext(AuthContext);
    const isCompanyAdmin = authData?.role === 'company_admin';
    const isInternalAdmin = authData?.role === 'internal_admin';

    const [users, setUsers] = useState([]);
    const [organizations, setOrganizations] = useState([]);
    const [selectedOrg, setSelectedOrg] = useState(organization ? organization.id : null);
    const [allUsers, setAllUsers] = useState([]);

    useEffect(() => {
        const fetchData = async () => {
            if (isInternalAdmin) {
                const orgResult = await organizationService.getOrganizations();
                if (orgResult.success) {
                    setOrganizations(orgResult.data || []);
                }
                const userResult = await userService.getUsers();
                if (userResult.success) {
                    setAllUsers(userResult.data || []);
                }
            } else if (isCompanyAdmin) {
                const result = await userService.getUsers();
                if (result.success) {
                    setUsers(result.data || []);
                }
            }
        };
        fetchData();
    }, [isInternalAdmin, isCompanyAdmin]);

    // Filter users when organization changes (for internal_admin)
    useEffect(() => {
        if (isInternalAdmin && selectedOrg) {
            setUsers(allUsers.filter(u => u.organization === selectedOrg));
        } else if (isInternalAdmin) {
            setUsers([]);
        }
    }, [selectedOrg, allUsers, isInternalAdmin]);

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
                    <Input placeholder={t.warehouseName}/>
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
                    <Input placeholder={t.warehouseCode}/>
                </Form.Item>
            </Flex>

            {isInternalAdmin && (
                <Form.Item
                    label={t.organization}
                    name="organization"
                    rules={[{required: true, message: t.orgRequired}]}
                    initialValue={organization ? organization.id : null}
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
                        onChange={(value) => setSelectedOrg(value)}
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
                    placeholder={isInternalAdmin && !selectedOrg ? t.selectOrgFirst : t.selectUsers}
                    disabled={isInternalAdmin && !selectedOrg}
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
                    icon={<PlusOutlined/>}
                    style={{height: 44, fontWeight: 600}}
                >
                    {t.add}
                </Button>
            </Form.Item>
        </>
    );
};

const AddWarehouseModal = ({visible, setVisible, onFinish, organization = null}) => {
    const {t} = useLanguage();

    return (
        <ModalForm
            visible={visible}
            setVisible={setVisible}
            onFinish={onFinish}
            title={t.addWarehouse}
        >
            <AddWarehouseForm organization={organization}/>
        </ModalForm>
    );
};

export default AddWarehouseModal;

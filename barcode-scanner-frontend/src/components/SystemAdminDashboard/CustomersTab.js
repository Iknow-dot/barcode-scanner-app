import React, {useState, useEffect, useCallback} from 'react';
import {customerService} from '../../api';
import {useLanguage} from '../../i18n/LanguageContext';
import useAppNotification from '../../hooks/useAppNotification';
import {
    Table,
    Typography,
    Flex,
    Button,
    Input,
    Popconfirm,
    Empty,
    Space,
    Modal,
    Form,
} from 'antd';
import {
    DeleteOutlined,
    ReloadOutlined,
    PlusOutlined,
    EditOutlined,
    SearchOutlined,
    UserOutlined,
    PhoneOutlined,
    MailOutlined,
    IdcardOutlined,
} from '@ant-design/icons';

const {Text} = Typography;

const CustomersTab = () => {
    const {t} = useLanguage();
    const {notify, contextHolder} = useAppNotification();
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [modalOpen, setModalOpen] = useState(false);
    const [editingCustomer, setEditingCustomer] = useState(null);
    const [modalLoading, setModalLoading] = useState(false);
    const [form] = Form.useForm();

    const fetchCustomers = useCallback(async (search) => {
        setLoading(true);
        try {
            const result = await customerService.getCustomers(search || undefined);
            if (result.success) {
                setCustomers(Array.isArray(result.data) ? result.data : result.data?.results || []);
            } else {
                notify.error(t.error, t.dataFetchError);
            }
        } catch (err) {
            console.error('Failed to fetch customers:', err);
            notify.error(t.error, t.dataFetchError);
        } finally {
            setLoading(false);
        }
    }, [t, notify]);

    useEffect(() => {
        fetchCustomers();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSearch = (value) => {
        setSearchQuery(value);
        fetchCustomers(value);
    };

    const handleDeleteCustomer = async (customerId) => {
        const result = await customerService.deleteCustomer(customerId);
        if (result.success) {
            notify.success(t.success, t.customerDeleted);
            setCustomers((prev) => prev.filter((c) => c.id !== customerId));
        } else {
            notify.error(t.error, t.customerDeleteError);
        }
    };

    const handleOpenCreateModal = () => {
        setEditingCustomer(null);
        form.resetFields();
        setModalOpen(true);
    };

    const handleOpenEditModal = (customer) => {
        setEditingCustomer(customer);
        form.setFieldsValue({
            first_name: customer.first_name,
            last_name: customer.last_name,
            phone: customer.phone || '',
            email: customer.email || '',
            identification_number: customer.identification_number || '',
        });
        setModalOpen(true);
    };

    const handleModalSubmit = async () => {
        try {
            const values = await form.validateFields();
            setModalLoading(true);

            let result;
            if (editingCustomer) {
                result = await customerService.updateCustomer(editingCustomer.id, values);
            } else {
                result = await customerService.createCustomer(values);
            }

            if (result.success) {
                notify.success(t.success, editingCustomer ? t.customerUpdated : t.customerCreated);
                setModalOpen(false);
                form.resetFields();
                setEditingCustomer(null);
                fetchCustomers(searchQuery || undefined);
            } else {
                notify.error(t.error, result.error);
            }
        } catch (err) {
            // Validation error — form handles display
        } finally {
            setModalLoading(false);
        }
    };

    const columns = [
        {
            title: t.firstName,
            dataIndex: 'first_name',
            key: 'first_name',
            sorter: (a, b) => (a.first_name || '').localeCompare(b.first_name || ''),
            render: (name) => (
                <Flex align="center" gap={6}>
                    <UserOutlined style={{opacity: 0.4}}/>
                    <Text strong>{name}</Text>
                </Flex>
            ),
        },
        {
            title: t.lastName,
            dataIndex: 'last_name',
            key: 'last_name',
            sorter: (a, b) => (a.last_name || '').localeCompare(b.last_name || ''),
            render: (name) => <Text>{name}</Text>,
        },
        {
            title: t.customerPhone,
            dataIndex: 'phone',
            key: 'phone',
            width: 150,
            render: (phone) => phone ? (
                <Flex align="center" gap={6}>
                    <PhoneOutlined style={{opacity: 0.4, fontSize: 13}}/>
                    <Text>{phone}</Text>
                </Flex>
            ) : <Text type="secondary">—</Text>,
        },
        {
            title: t.customerEmail,
            dataIndex: 'email',
            key: 'email',
            width: 200,
            render: (email) => email ? (
                <Flex align="center" gap={6}>
                    <MailOutlined style={{opacity: 0.4, fontSize: 13}}/>
                    <Text>{email}</Text>
                </Flex>
            ) : <Text type="secondary">—</Text>,
        },
        {
            title: t.customerIdNumber,
            dataIndex: 'identification_number',
            key: 'identification_number',
            width: 160,
            render: (idNum) => idNum ? (
                <Flex align="center" gap={6}>
                    <IdcardOutlined style={{opacity: 0.4, fontSize: 13}}/>
                    <Text>{idNum}</Text>
                </Flex>
            ) : <Text type="secondary">—</Text>,
        },
        {
            title: t.orderDate,
            dataIndex: 'created_at',
            key: 'created_at',
            width: 120,
            sorter: (a, b) => new Date(a.created_at) - new Date(b.created_at),
            defaultSortOrder: 'descend',
            render: (date) => date ? (
                <Text type="secondary" style={{fontSize: 12}}>
                    {new Date(date).toLocaleDateString()}
                </Text>
            ) : null,
        },
        {
            title: '',
            key: 'actions',
            width: 80,
            align: 'center',
            render: (_, record) => (
                <Space size={4}>
                    <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined/>}
                        onClick={() => handleOpenEditModal(record)}
                    />
                    <Popconfirm
                        title={t.confirmDelete}
                        onConfirm={() => handleDeleteCustomer(record.id)}
                        okText={t.yes}
                        cancelText={t.no}
                    >
                        <Button
                            type="text"
                            danger
                            size="small"
                            icon={<DeleteOutlined/>}
                        />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <>
            {contextHolder}

            {/* Toolbar */}
            <Flex justify="space-between" align="center" wrap="wrap" gap={12} style={{marginBottom: 16}}>
                <Space size={12}>
                    <Input.Search
                        placeholder={t.searchCustomer}
                        allowClear
                        onSearch={handleSearch}
                        style={{width: 260}}
                        prefix={<SearchOutlined style={{opacity: 0.4}}/>}
                    />
                </Space>
                <Space size={8}>
                    <Button
                        type="primary"
                        icon={<PlusOutlined/>}
                        onClick={handleOpenCreateModal}
                    >
                        {t.createCustomer}
                    </Button>
                    <Button
                        icon={<ReloadOutlined/>}
                        onClick={() => fetchCustomers(searchQuery || undefined)}
                        loading={loading}
                    />
                </Space>
            </Flex>

            {/* Customers Table */}
            <Table
                dataSource={customers.map((c) => ({...c, key: c.id}))}
                columns={columns}
                loading={loading}
                size="middle"
                pagination={{pageSize: 15, showSizeChanger: true, pageSizeOptions: ['10', '15', '25', '50']}}
                locale={{
                    emptyText: (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description={t.noCustomersFound}
                        />
                    ),
                }}
            />

            {/* Create / Edit Customer Modal */}
            <Modal
                title={editingCustomer ? t.editCustomer : t.createCustomer}
                open={modalOpen}
                onOk={handleModalSubmit}
                onCancel={() => {
                    setModalOpen(false);
                    setEditingCustomer(null);
                    form.resetFields();
                }}
                confirmLoading={modalLoading}
                okText={t.save}
                cancelText={t.close}
                destroyOnClose
            >
                <Form
                    form={form}
                    layout="vertical"
                    style={{marginTop: 16}}
                >
                    <Form.Item
                        name="first_name"
                        label={t.firstName}
                        rules={[{required: true, message: t.firstNameRequired}]}
                    >
                        <Input prefix={<UserOutlined style={{opacity: 0.4}}/>}/>
                    </Form.Item>
                    <Form.Item
                        name="last_name"
                        label={t.lastName}
                        rules={[{required: true, message: t.lastNameRequired}]}
                    >
                        <Input prefix={<UserOutlined style={{opacity: 0.4}}/>}/>
                    </Form.Item>
                    <Form.Item
                        name="phone"
                        label={t.customerPhone}
                    >
                        <Input prefix={<PhoneOutlined style={{opacity: 0.4}}/>}/>
                    </Form.Item>
                    <Form.Item
                        name="email"
                        label={t.customerEmail}
                        rules={[{type: 'email', message: t.emailInvalid}]}
                    >
                        <Input prefix={<MailOutlined style={{opacity: 0.4}}/>}/>
                    </Form.Item>
                    <Form.Item
                        name="identification_number"
                        label={t.customerIdNumber}
                    >
                        <Input prefix={<IdcardOutlined style={{opacity: 0.4}}/>}/>
                    </Form.Item>
                </Form>
            </Modal>
        </>
    );
};

export default CustomersTab;

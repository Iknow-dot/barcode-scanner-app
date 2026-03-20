import React, {useState, useEffect, useCallback, useMemo} from 'react';
import {customerService} from '../../api';
import {useLanguage} from '../../i18n/LanguageContext';
import useAppNotification from '../../hooks/useAppNotification';
import {countries, georgianCities, countryCodes} from '../../data/geoData';
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
    Tag,
    Select,
    Divider,
    message,
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
    CloudDownloadOutlined,
    MinusCircleOutlined,
    EnvironmentOutlined,
} from '@ant-design/icons';

const {Text} = Typography;

const CustomersTab = () => {
    const {t, language} = useLanguage();
    const lang = language || 'ka';
    const {notify, contextHolder} = useAppNotification();
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [modalOpen, setModalOpen] = useState(false);
    const [editingCustomer, setEditingCustomer] = useState(null);
    const [modalLoading, setModalLoading] = useState(false);
    const [rsGeLookupLoading, setRsGeLookupLoading] = useState(false);
    const [form] = Form.useForm();

    // Watch country and city for cascading selects
    const selectedCountry = Form.useWatch('country', form);
    const selectedCity = Form.useWatch('city', form);

    // Build city options based on selected country
    const cityOptions = useMemo(() => {
        if (selectedCountry === 'GE') {
            return Object.entries(georgianCities).map(([key, city]) => ({
                value: key,
                label: city.label[lang] || city.label.en,
            }));
        }
        return [];
    }, [selectedCountry, lang]);

    // Build district options based on selected city
    const districtOptions = useMemo(() => {
        if (selectedCountry === 'GE' && selectedCity && georgianCities[selectedCity]) {
            return georgianCities[selectedCity].districts.map(d => ({
                value: d.value,
                label: d.label[lang] || d.label.en,
            }));
        }
        return [];
    }, [selectedCountry, selectedCity, lang]);

    // Country select options
    const countryOptions = useMemo(() =>
        countries.map(c => ({
            value: c.value,
            label: c.label[lang] || c.label.en,
        })),
    [lang]);

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
        form.setFieldsValue({
            phone_numbers: [{country_code: '+995'}],
            country: 'GE',
        });
        setModalOpen(true);
    };

    const handleOpenEditModal = (customer) => {
        setEditingCustomer(customer);
        const phoneNumbers = customer.phone_numbers && customer.phone_numbers.length > 0
            ? customer.phone_numbers.map(p => ({
                country_code: p.country_code || '+995',
                phone: p.phone,
                label: p.label || '',
            }))
            : (customer.phone ? [{country_code: '+995', phone: customer.phone, label: ''}] : [{country_code: '+995'}]);

        form.setFieldsValue({
            identification_number: customer.identification_number || '',
            first_name: customer.first_name,
            last_name: customer.last_name,
            phone_numbers: phoneNumbers,
            email: customer.email || '',
            country: customer.country || '',
            city: customer.city || '',
            district: customer.district || '',
            address: customer.address || '',
        });
        setModalOpen(true);
    };

    const handleRsGeLookup = async () => {
        const idNumber = form.getFieldValue('identification_number')?.trim();
        if (!idNumber) {
            message.warning(t.customerIdNumberRequired);
            return;
        }

        setRsGeLookupLoading(true);
        try {
            const result = await customerService.lookupRsGe(idNumber);
            if (result.success && result.data) {
                const {first_name, last_name} = result.data;
                form.setFieldsValue({
                    first_name: first_name || form.getFieldValue('first_name') || '',
                    last_name: last_name || form.getFieldValue('last_name') || '',
                });
                message.success(t.rsGeFound);
            } else {
                const errorCode = result.code;
                if (errorCode === 'RS_GE_NOT_FOUND' || result.status === 404) {
                    message.warning(t.rsGeNotFound);
                } else if (errorCode === 'RS_GE_TIMEOUT' || result.status === 504) {
                    message.error(t.rsGeTimeout);
                } else {
                    message.error(t.rsGeError);
                }
            }
        } catch (err) {
            message.error(t.rsGeError);
        } finally {
            setRsGeLookupLoading(false);
        }
    };

    const handleModalSubmit = async () => {
        try {
            const values = await form.validateFields();
            setModalLoading(true);

            const payload = {
                ...values,
                phone_numbers: (values.phone_numbers || []).filter(p => p && p.phone),
            };

            let result;
            if (editingCustomer) {
                result = await customerService.updateCustomer(editingCustomer.id, payload);
            } else {
                result = await customerService.createCustomer(payload);
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

    /** Format a phone entry for display */
    const formatPhone = (p) => {
        const code = p.country_code || '+995';
        return `${code} ${p.phone}`;
    };

    const renderPhones = (_, record) => {
        const phones = record.phone_numbers && record.phone_numbers.length > 0
            ? record.phone_numbers
            : (record.phone ? [{country_code: '+995', phone: record.phone, label: ''}] : []);

        if (phones.length === 0) {
            return <Text type="secondary">—</Text>;
        }

        return (
            <Space size={4} wrap>
                {phones.map((p, idx) => (
                    <Tag key={idx} icon={<PhoneOutlined style={{fontSize: 11}}/>} color="blue" style={{margin: 2}}>
                        {formatPhone(p)}{p.label ? ` (${p.label})` : ''}
                    </Tag>
                ))}
            </Space>
        );
    };

    /** Format address for display */
    const renderAddress = (_, record) => {
        const parts = [];
        if (record.country) {
            const c = countries.find(x => x.value === record.country);
            if (c) parts.push(c.label[lang] || c.label.en);
            else parts.push(record.country);
        }
        if (record.city) {
            const c = georgianCities[record.city];
            if (c) parts.push(c.label[lang] || c.label.en);
            else parts.push(record.city);
        }
        if (record.district) {
            // Try to find district label
            if (record.city && georgianCities[record.city]) {
                const d = georgianCities[record.city].districts.find(x => x.value === record.district);
                if (d) parts.push(d.label[lang] || d.label.en);
                else parts.push(record.district);
            } else {
                parts.push(record.district);
            }
        }
        if (record.address) parts.push(record.address);

        if (parts.length === 0) return <Text type="secondary">—</Text>;

        return (
            <Flex align="center" gap={6}>
                <EnvironmentOutlined style={{opacity: 0.4, fontSize: 13}}/>
                <Text style={{fontSize: 12}}>{parts.join(', ')}</Text>
            </Flex>
        );
    };

    const columns = [
        {
            title: t.customerIdNumber,
            dataIndex: 'identification_number',
            key: 'identification_number',
            width: 160,
            render: (idNum) => idNum ? (
                <Flex align="center" gap={6}>
                    <IdcardOutlined style={{opacity: 0.4, fontSize: 13}}/>
                    <Text strong>{idNum}</Text>
                </Flex>
            ) : <Text type="secondary">—</Text>,
        },
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
            key: 'phone_numbers',
            width: 240,
            render: renderPhones,
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
            title: t.customerAddress,
            key: 'address',
            width: 250,
            render: renderAddress,
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

    /** Country code select to prepend to phone input */
    const CountryCodeSelect = ({value, onChange}) => (
        <Select
            value={value || '+995'}
            onChange={onChange}
            style={{width: 110}}
            showSearch
            optionFilterProp="label"
            options={countryCodes.map(c => ({value: c.value, label: c.label}))}
        />
    );

    return (
        <>
            {contextHolder}

            {/* Toolbar */}
            <Flex justify="space-between" align="center" wrap="wrap" gap={12} style={{marginBottom: 16}}>
                <Input.Search
                    placeholder={t.searchCustomer}
                    allowClear
                    onSearch={handleSearch}
                    style={{width: '100%', maxWidth: 260}}
                    prefix={<SearchOutlined style={{opacity: 0.4}}/>}
                />
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
                scroll={{x: 1200}}
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
                width={600}
            >
                <Form
                    form={form}
                    layout="vertical"
                    style={{marginTop: 16}}
                    initialValues={{phone_numbers: [{country_code: '+995'}], country: 'GE'}}
                >
                    {/* ID Number with RS.ge lookup */}
                    <Form.Item
                        name="identification_number"
                        label={t.customerIdNumber}
                        rules={[{required: true, message: t.customerIdNumberRequired}]}
                    >
                        <Input
                            prefix={<IdcardOutlined style={{opacity: 0.4}}/>}
                            suffix={
                                <Button
                                    type="link"
                                    size="small"
                                    icon={<CloudDownloadOutlined/>}
                                    loading={rsGeLookupLoading}
                                    onClick={handleRsGeLookup}
                                    style={{padding: '0 4px', fontSize: 12}}
                                >
                                    {rsGeLookupLoading ? t.lookingUpRsGe : t.lookupFromRsGe}
                                </Button>
                            }
                        />
                    </Form.Item>

                    <Flex gap={12}>
                        <Form.Item
                            name="first_name"
                            label={t.firstName}
                            rules={[{required: true, message: t.firstNameRequired}]}
                            style={{flex: 1}}
                        >
                            <Input prefix={<UserOutlined style={{opacity: 0.4}}/>}/>
                        </Form.Item>
                        <Form.Item
                            name="last_name"
                            label={t.lastName}
                            rules={[{required: true, message: t.lastNameRequired}]}
                            style={{flex: 1}}
                        >
                            <Input prefix={<UserOutlined style={{opacity: 0.4}}/>}/>
                        </Form.Item>
                    </Flex>

                    {/* Multiple phone numbers with country code */}
                    <Form.List name="phone_numbers">
                        {(fields, {add, remove}) => (
                            <>
                                {fields.map(({key, name, ...restField}) => (
                                    <Flex key={key} gap={8} align="baseline">
                                        <Form.Item
                                            {...restField}
                                            name={[name, 'country_code']}
                                            label={name === 0 ? t.countryCode : ' '}
                                            style={{width: 120}}
                                            initialValue="+995"
                                        >
                                            <CountryCodeSelect/>
                                        </Form.Item>
                                        <Form.Item
                                            {...restField}
                                            name={[name, 'phone']}
                                            label={name === 0 ? t.customerPhone : ' '}
                                            style={{flex: 1}}
                                        >
                                            <Input
                                                prefix={<PhoneOutlined style={{opacity: 0.4}}/>}
                                                placeholder={t.customerPhone}
                                            />
                                        </Form.Item>
                                        <Form.Item
                                            {...restField}
                                            name={[name, 'label']}
                                            label={name === 0 ? t.phoneLabel : ' '}
                                            style={{width: 100}}
                                        >
                                            <Input placeholder={t.phoneLabelPlaceholder || 'mobile'}/>
                                        </Form.Item>
                                        {fields.length > 1 && (
                                            <MinusCircleOutlined
                                                onClick={() => remove(name)}
                                                style={{color: '#ff4d4f', fontSize: 18, marginTop: name === 0 ? 32 : 8}}
                                            />
                                        )}
                                    </Flex>
                                ))}
                                <Form.Item>
                                    <Button
                                        type="dashed"
                                        onClick={() => add({country_code: '+995'})}
                                        block
                                        icon={<PlusOutlined/>}
                                    >
                                        {t.addPhoneNumber}
                                    </Button>
                                </Form.Item>
                            </>
                        )}
                    </Form.List>

                    <Form.Item
                        name="email"
                        label={t.customerEmail}
                        rules={[{type: 'email', message: t.emailInvalid}]}
                    >
                        <Input prefix={<MailOutlined style={{opacity: 0.4}}/>}/>
                    </Form.Item>

                    {/* Address section */}
                    <Divider style={{margin: '8px 0 16px'}}>
                        <Text type="secondary" style={{fontSize: 13}}>
                            <EnvironmentOutlined style={{marginRight: 6}}/>
                            {t.customerAddress}
                        </Text>
                    </Divider>

                    <Flex gap={12}>
                        <Form.Item
                            name="country"
                            label={t.country}
                            style={{flex: 1}}
                        >
                            <Select
                                showSearch
                                allowClear
                                placeholder={t.selectCountry}
                                optionFilterProp="label"
                                options={countryOptions}
                                onChange={() => {
                                    form.setFieldsValue({city: undefined, district: undefined});
                                }}
                            />
                        </Form.Item>
                        <Form.Item
                            name="city"
                            label={t.city}
                            style={{flex: 1}}
                        >
                            {selectedCountry === 'GE' ? (
                                <Select
                                    showSearch
                                    allowClear
                                    placeholder={t.selectCity}
                                    optionFilterProp="label"
                                    options={cityOptions}
                                    onChange={() => {
                                        form.setFieldsValue({district: undefined});
                                    }}
                                />
                            ) : (
                                <Input placeholder={t.city}/>
                            )}
                        </Form.Item>
                    </Flex>

                    <Flex gap={12}>
                        <Form.Item
                            name="district"
                            label={t.district}
                            style={{flex: 1}}
                        >
                            {selectedCountry === 'GE' && districtOptions.length > 0 ? (
                                <Select
                                    showSearch
                                    allowClear
                                    placeholder={t.selectDistrict}
                                    optionFilterProp="label"
                                    options={districtOptions}
                                />
                            ) : (
                                <Input placeholder={t.district}/>
                            )}
                        </Form.Item>
                        <Form.Item
                            name="address"
                            label={t.addressLine}
                            style={{flex: 1}}
                        >
                            <Input placeholder={t.addressLine}/>
                        </Form.Item>
                    </Flex>
                </Form>
            </Modal>
        </>
    );
};

export default CustomersTab;

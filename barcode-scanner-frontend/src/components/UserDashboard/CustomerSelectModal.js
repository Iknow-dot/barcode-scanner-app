import React, {useState, useEffect, useCallback, useMemo} from 'react';
import {customerService} from '../../api';
import {useLanguage} from '../../i18n/LanguageContext';
import {countries, georgianCities, countryCodes} from '../../data/geoData';
import {
    Modal,
    Input,
    List,
    Button,
    Form,
    Divider,
    Flex,
    Typography,
    Empty,
    Spin,
    Space,
    Tag,
    Select,
    message,
} from 'antd';
import {
    UserAddOutlined,
    SearchOutlined,
    UserOutlined,
    PhoneOutlined,
    IdcardOutlined,
    CloudDownloadOutlined,
    PlusOutlined,
    MinusCircleOutlined,
    EnvironmentOutlined,
} from '@ant-design/icons';

const {Text} = Typography;

const CustomerSelectModal = ({open, onSelect, onClose}) => {
    const {t, language} = useLanguage();
    const lang = language || 'ka';
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [createLoading, setCreateLoading] = useState(false);
    const [rsGeLookupLoading, setRsGeLookupLoading] = useState(false);
    const [form] = Form.useForm();

    // Watch country and city for cascading selects
    const selectedCountry = Form.useWatch('country', form);
    const selectedCity = Form.useWatch('city', form);

    const cityOptions = useMemo(() => {
        if (selectedCountry === 'GE') {
            return Object.entries(georgianCities).map(([key, city]) => ({
                value: key,
                label: city.label[lang] || city.label.en,
            }));
        }
        return [];
    }, [selectedCountry, lang]);

    const districtOptions = useMemo(() => {
        if (selectedCountry === 'GE' && selectedCity && georgianCities[selectedCity]) {
            return georgianCities[selectedCity].districts.map(d => ({
                value: d.value,
                label: d.label[lang] || d.label.en,
            }));
        }
        return [];
    }, [selectedCountry, selectedCity, lang]);

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
                setCustomers(result.data);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (open) {
            fetchCustomers();
            setShowCreateForm(false);
            setSearchQuery('');
            form.resetFields();
        }
    }, [open, fetchCustomers, form]);

    const handleSearch = (value) => {
        setSearchQuery(value);
        fetchCustomers(value);
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

    const handleCreateCustomer = async (values) => {
        setCreateLoading(true);
        try {
            const payload = {
                ...values,
                phone_numbers: (values.phone_numbers || []).filter(p => p && p.phone),
            };
            const result = await customerService.createCustomer(payload);
            if (result.success) {
                onSelect(result.data);
                form.resetFields();
                setShowCreateForm(false);
            }
        } finally {
            setCreateLoading(false);
        }
    };

    const handleSelectCustomer = (customer) => {
        onSelect(customer);
    };

    /** Format phone for display */
    const formatPhone = (p) => {
        const code = p.country_code || '+995';
        return `${code} ${p.phone}`;
    };

    const renderPhoneTags = (customer) => {
        const phones = customer.phone_numbers && customer.phone_numbers.length > 0
            ? customer.phone_numbers
            : (customer.phone ? [{country_code: '+995', phone: customer.phone, label: ''}] : []);

        return phones.map((p, idx) => (
            <Tag key={idx} icon={<PhoneOutlined/>} color="blue">
                {formatPhone(p)}{p.label ? ` (${p.label})` : ''}
            </Tag>
        ));
    };

    /** Country code select component */
    const CountryCodeSelect = ({value, onChange}) => (
        <Select
            value={value || '+995'}
            onChange={onChange}
            style={{width: 110}}
            showSearch
            optionFilterProp="label"
            options={countryCodes.map(c => ({value: c.value, label: c.label}))}
            size="large"
        />
    );

    return (
        <Modal
            title={
                <Flex align="center" gap={8}>
                    <UserOutlined style={{fontSize: 18, color: '#1677ff'}}/>
                    <span style={{fontWeight: 600}}>{t.selectCustomer}</span>
                </Flex>
            }
            open={open}
            onCancel={onClose}
            footer={null}
            width={580}
            styles={{body: {maxHeight: '75vh', overflowY: 'auto'}}}
        >
            {/* Search existing customers */}
            <Input.Search
                placeholder={t.searchCustomer}
                prefix={<SearchOutlined/>}
                size="large"
                allowClear
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onSearch={handleSearch}
                style={{marginBottom: 16, borderRadius: 10}}
            />

            <Spin spinning={loading}>
                {customers.length > 0 ? (
                    <List
                        dataSource={customers}
                        renderItem={(customer) => (
                            <List.Item
                                key={customer.id}
                                onClick={() => handleSelectCustomer(customer)}
                                style={{
                                    cursor: 'pointer',
                                    borderRadius: 8,
                                    padding: '12px 16px',
                                    marginBottom: 4,
                                    transition: 'background 0.2s',
                                }}
                                className="customer-list-item"
                                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(22, 119, 255, 0.06)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                            >
                                <List.Item.Meta
                                    avatar={
                                        <div style={{
                                            width: 40,
                                            height: 40,
                                            borderRadius: '50%',
                                            background: '#1677ff',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: '#fff',
                                            fontWeight: 600,
                                            fontSize: 16,
                                        }}>
                                            {customer.first_name?.charAt(0)?.toUpperCase()}
                                        </div>
                                    }
                                    title={
                                        <Text strong>
                                            {customer.first_name} {customer.last_name}
                                        </Text>
                                    }
                                    description={
                                        <Space size={8} wrap>
                                            {renderPhoneTags(customer)}
                                            {customer.identification_number && (
                                                <Tag icon={<IdcardOutlined/>} color="default">
                                                    {customer.identification_number}
                                                </Tag>
                                            )}
                                        </Space>
                                    }
                                />
                            </List.Item>
                        )}
                        style={{maxHeight: 300, overflowY: 'auto'}}
                    />
                ) : (
                    !loading && (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description={t.noCustomersFound}
                            style={{margin: '20px 0'}}
                        />
                    )
                )}
            </Spin>

            {/* Create new customer section */}
            <Divider style={{margin: '16px 0'}}>
                <Text type="secondary" style={{fontSize: 13}}>{t.orCreateNew}</Text>
            </Divider>

            {!showCreateForm ? (
                <Flex justify="center">
                    <Button
                        type="dashed"
                        icon={<UserAddOutlined/>}
                        size="large"
                        onClick={() => setShowCreateForm(true)}
                        style={{borderRadius: 10, width: '100%'}}
                    >
                        {t.createCustomer}
                    </Button>
                </Flex>
            ) : (
                <Form
                    form={form}
                    layout="vertical"
                    onFinish={handleCreateCustomer}
                    style={{marginTop: 8}}
                    initialValues={{phone_numbers: [{country_code: '+995'}], country: 'GE'}}
                >
                    {/* ID Number with RS.ge lookup */}
                    <Form.Item
                        name="identification_number"
                        label={t.customerIdNumber}
                        rules={[{required: true, message: t.customerIdNumberRequired}]}
                    >
                        <Input
                            size="large"
                            placeholder={t.customerIdNumber}
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
                            <Input size="large" placeholder={t.firstName}/>
                        </Form.Item>
                        <Form.Item
                            name="last_name"
                            label={t.lastName}
                            rules={[{required: true, message: t.lastNameRequired}]}
                            style={{flex: 1}}
                        >
                            <Input size="large" placeholder={t.lastName}/>
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
                                                size="large"
                                                placeholder={t.customerPhone}
                                                prefix={<PhoneOutlined style={{opacity: 0.4}}/>}
                                            />
                                        </Form.Item>
                                        <Form.Item
                                            {...restField}
                                            name={[name, 'label']}
                                            label={name === 0 ? t.phoneLabel : ' '}
                                            style={{width: 100}}
                                        >
                                            <Input size="large" placeholder={t.phoneLabelPlaceholder || 'mobile'}/>
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
                    >
                        <Input size="large" placeholder={t.customerEmail}/>
                    </Form.Item>

                    {/* Address section */}
                    <Divider style={{margin: '8px 0 16px'}}>
                        <Text type="secondary" style={{fontSize: 13}}>
                            <EnvironmentOutlined style={{marginRight: 6}}/>
                            {t.customerAddress}
                        </Text>
                    </Divider>

                    <Flex gap={12}>
                        <Form.Item name="country" label={t.country} style={{flex: 1}}>
                            <Select
                                showSearch
                                allowClear
                                size="large"
                                placeholder={t.selectCountry}
                                optionFilterProp="label"
                                options={countryOptions}
                                onChange={() => {
                                    form.setFieldsValue({city: undefined, district: undefined});
                                }}
                            />
                        </Form.Item>
                        <Form.Item name="city" label={t.city} style={{flex: 1}}>
                            {selectedCountry === 'GE' ? (
                                <Select
                                    showSearch
                                    allowClear
                                    size="large"
                                    placeholder={t.selectCity}
                                    optionFilterProp="label"
                                    options={cityOptions}
                                    onChange={() => {
                                        form.setFieldsValue({district: undefined});
                                    }}
                                />
                            ) : (
                                <Input size="large" placeholder={t.city}/>
                            )}
                        </Form.Item>
                    </Flex>

                    <Flex gap={12}>
                        <Form.Item name="district" label={t.district} style={{flex: 1}}>
                            {selectedCountry === 'GE' && districtOptions.length > 0 ? (
                                <Select
                                    showSearch
                                    allowClear
                                    size="large"
                                    placeholder={t.selectDistrict}
                                    optionFilterProp="label"
                                    options={districtOptions}
                                />
                            ) : (
                                <Input size="large" placeholder={t.district}/>
                            )}
                        </Form.Item>
                        <Form.Item name="address" label={t.addressLine} style={{flex: 1}}>
                            <Input size="large" placeholder={t.addressLine}/>
                        </Form.Item>
                    </Flex>

                    <Flex gap={8} justify="end">
                        <Button onClick={() => {
                            setShowCreateForm(false);
                            form.resetFields();
                        }}>
                            {t.close}
                        </Button>
                        <Button
                            type="primary"
                            htmlType="submit"
                            loading={createLoading}
                            icon={<UserAddOutlined/>}
                        >
                            {t.createCustomer}
                        </Button>
                    </Flex>
                </Form>
            )}
        </Modal>
    );
};

export default CustomerSelectModal;

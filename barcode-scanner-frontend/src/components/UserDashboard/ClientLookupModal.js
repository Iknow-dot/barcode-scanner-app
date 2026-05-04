import React, {useState, useEffect, useRef, useCallback} from 'react';
import {clientService} from '../../api';
import {useLanguage} from '../../i18n/LanguageContext';
import AddressMapPicker from './AddressMapPicker';
import {
    Modal,
    Input,
    AutoComplete,
    Button,
    Form,
    Divider,
    Flex,
    Typography,
    Card,
    Alert,
    Segmented,
    Descriptions,
    message,
} from 'antd';
import {
    UserAddOutlined,
    UserOutlined,
    PhoneOutlined,
    IdcardOutlined,
    CloudDownloadOutlined,
    SearchOutlined,
    EnvironmentOutlined,
    LoadingOutlined,
    ArrowLeftOutlined,
} from '@ant-design/icons';

const {Text} = Typography;

const ERROR_CODE_MESSAGES = {
    EXTERNAL_SERVICE_TIMEOUT: 'externalServiceTimeout',
    EXTERNAL_SERVICE_UNAVAILABLE: 'externalServiceUnavailable',
    EXTERNAL_SERVICE_UNAUTHORIZED: 'externalServiceUnauthorized',
    EXTERNAL_SERVICE_ERROR: 'externalServiceError',
    CLIENT_ALREADY_EXISTS: 'clientAlreadyExists',
};

const STEP_LOOKUP = 'lookup';
const STEP_CREATE = 'create';

const AUTO_LOOKUP_DEBOUNCE_MS = 1500;
const ADDRESS_SEARCH_MIN_CHARS = 3;
const ADDRESS_SEARCH_DEBOUNCE_MS = 300;

const ClientLookupModal = ({open, onSelect, onClose}) => {
    const {t} = useLanguage();
    const [step, setStep] = useState(STEP_LOOKUP);
    const [lookupForm] = Form.useForm();
    const [createForm] = Form.useForm();
    const [lookupLoading, setLookupLoading] = useState(false);
    const [createLoading, setCreateLoading] = useState(false);
    const [rsGeLookupLoading, setRsGeLookupLoading] = useState(false);
    const [resolvingAddress, setResolvingAddress] = useState(false);
    const [foundClients, setFoundClients] = useState([]);
    const [foundClientsFilter, setFoundClientsFilter] = useState('');
    const [lookupSeed, setLookupSeed] = useState({identification_number: '', phone: ''});
    const [addressOptions, setAddressOptions] = useState([]);
    const [addressSearching, setAddressSearching] = useState(false);
    const [mapPosition, setMapPosition] = useState(null);
    const lastAutoLookupId = useRef('');
    const autoLookupTimer = useRef(null);
    const addressSearchTimer = useRef(null);
    const addressSearchSeq = useRef(0);

    useEffect(() => {
        if (open) {
            setStep(STEP_LOOKUP);
            setFoundClients([]);
            setFoundClientsFilter('');
            setLookupSeed({identification_number: '', phone: ''});
            setAddressOptions([]);
            setAddressSearching(false);
            setMapPosition(null);
            lastAutoLookupId.current = '';
            if (autoLookupTimer.current) {
                clearTimeout(autoLookupTimer.current);
                autoLookupTimer.current = null;
            }
            if (addressSearchTimer.current) {
                clearTimeout(addressSearchTimer.current);
                addressSearchTimer.current = null;
            }
            // Bump the sequence so any in-flight search resolves into a stale
            // request and is dropped.
            addressSearchSeq.current += 1;
            lookupForm.resetFields();
            createForm.resetFields();
            createForm.setFieldsValue({is_phys: true});
        }
    }, [open, lookupForm, createForm]);

    useEffect(() => {
        return () => {
            if (autoLookupTimer.current) {
                clearTimeout(autoLookupTimer.current);
            }
            if (addressSearchTimer.current) {
                clearTimeout(addressSearchTimer.current);
            }
        };
    }, []);

    const showErrorMessage = (code, fallback) => {
        const key = ERROR_CODE_MESSAGES[code];
        message.error((key && t[key]) || fallback);
    };

    const performLookup = async (idNumber, phone) => {
        if (!idNumber && !phone) {
            message.warning(t.enterIdOrPhone);
            return;
        }
        setLookupLoading(true);
        setFoundClients([]);
        setFoundClientsFilter('');
        try {
            const result = await clientService.checkClient({
                identification_number: idNumber,
                phone,
            });
            if (result.success) {
                // Upstream returns a list of {name, address, phone}; preserve
                // the typed identifier so the caller can still attach it to a
                // downstream order record.
                const clients = Array.isArray(result.data?.clients)
                    ? result.data.clients
                    : [];
                const merged = clients.map((c) => ({
                    ...c,
                    identification_number:
                        c?.identification_number || idNumber || '',
                    phone: c?.phone || phone || '',
                }));
                // Single hit: skip the picker and hand it straight off.
                if (merged.length === 1) {
                    onSelect(merged[0]);
                    return;
                }
                setFoundClients(merged);
            } else if (result.code === 'CLIENT_NOT_FOUND') {
                setLookupSeed({identification_number: idNumber, phone});
                createForm.setFieldsValue({
                    identification_number: idNumber,
                    phone: phone,
                    is_phys: true,
                });
                setStep(STEP_CREATE);
            } else {
                showErrorMessage(result.code, t.clientLookupError);
            }
        } finally {
            setLookupLoading(false);
        }
    };

    const handleLookup = (values) => {
        return performLookup(
            (values.identification_number || '').trim(),
            (values.phone || '').trim(),
        );
    };

    const handleCreateNewClient = () => {
        if (autoLookupTimer.current) {
            clearTimeout(autoLookupTimer.current);
            autoLookupTimer.current = null;
        }
        const values = lookupForm.getFieldsValue();
        const idNumber = (values.identification_number || '').trim();
        const phone = (values.phone || '').trim();
        setLookupSeed({identification_number: idNumber, phone});
        createForm.setFieldsValue({
            identification_number: idNumber,
            phone,
            is_phys: true,
        });
        setStep(STEP_CREATE);
    };

    // Debounced auto-lookup keyed off real user input only — using onValuesChange
    // (not Form.useWatch) avoids a spurious re-fire when the lookup step
    // remounts after the user backs out of the create step.
    const handleLookupValuesChange = (changed) => {
        if (!('identification_number' in changed)) return;
        if (autoLookupTimer.current) {
            clearTimeout(autoLookupTimer.current);
            autoLookupTimer.current = null;
        }
        const value = (changed.identification_number || '').trim();
        if (!value) {
            lastAutoLookupId.current = '';
            return;
        }
        if (lastAutoLookupId.current === value) return;
        autoLookupTimer.current = setTimeout(() => {
            autoLookupTimer.current = null;
            lastAutoLookupId.current = value;
            performLookup(value, '');
        }, AUTO_LOOKUP_DEBOUNCE_MS);
    };

    const handleRsGeLookup = async () => {
        const idNumber = createForm.getFieldValue('identification_number')?.trim();
        if (!idNumber) {
            message.warning(t.customerIdNumberRequired);
            return;
        }

        setRsGeLookupLoading(true);
        try {
            const result = await clientService.lookupRsGe(idNumber);
            if (result.success && result.data) {
                const {first_name, last_name} = result.data;
                createForm.setFieldsValue({
                    first_name: first_name || createForm.getFieldValue('first_name') || '',
                    last_name: last_name || createForm.getFieldValue('last_name') || '',
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
        } finally {
            setRsGeLookupLoading(false);
        }
    };

    const handleCreate = async (values) => {
        setCreateLoading(true);
        try {
            const payload = {
                first_name: values.first_name,
                last_name: values.last_name,
                identification_number: values.identification_number || '',
                is_phys: values.is_phys !== false,
                phone: values.phone || '',
                phone_2: values.phone_2 || '',
                email: values.email || '',
                address_line: values.address_line || '',
            };
            const result = await clientService.createClient(payload);
            if (result.success) {
                message.success(t.clientCreated);
                // Upstream returns name/address/phone; fold the typed values
                // back in so the caller can still attach the personal_number
                // and the just-created name/address even if the upstream
                // payload omits any of them.
                const typedName = [values.first_name, values.last_name].filter(Boolean).join(' ').trim();
                onSelect({
                    ...result.data,
                    name: result.data?.name || typedName,
                    identification_number:
                        result.data?.identification_number || values.identification_number || '',
                    phone: result.data?.phone || values.phone || '',
                    address: result.data?.address || values.address_line || '',
                });
            } else {
                showErrorMessage(result.code, t.clientCreateError);
            }
        } finally {
            setCreateLoading(false);
        }
    };

    const handleAddressResolved = (address) => {
        createForm.setFieldsValue({address_line: address});
    };

    const filteredFoundClients = (() => {
        const q = foundClientsFilter.trim().toLowerCase();
        if (!q) return foundClients;
        return foundClients.filter((c) => {
            const haystack = [c.name, c.address, c.phone]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            return haystack.includes(q);
        });
    })();

    const runAddressSearch = useCallback(async (query) => {
        const trimmed = (query || '').trim();
        if (trimmed.length < ADDRESS_SEARCH_MIN_CHARS) {
            setAddressOptions([]);
            setAddressSearching(false);
            return;
        }
        const requestId = ++addressSearchSeq.current;
        setAddressSearching(true);
        const result = await clientService.searchAddresses(trimmed);
        // A newer search has already been kicked off (or the modal closed) —
        // drop this response so we don't flicker stale options into the list.
        if (requestId !== addressSearchSeq.current) return;
        if (result.success) {
            const suggestions = Array.isArray(result.data?.suggestions)
                ? result.data.suggestions
                : [];
            // Suggestions arrive shaped as {label, lat, lng}. Keep lat/lng on
            // each option so onSelect can recenter the map pin.
            setAddressOptions(
                suggestions.map((s) => ({
                    value: s.label,
                    label: s.label,
                    lat: s.lat,
                    lng: s.lng,
                })),
            );
        } else {
            setAddressOptions([]);
        }
        setAddressSearching(false);
    }, []);

    const handleAddressSearch = (value) => {
        if (addressSearchTimer.current) {
            clearTimeout(addressSearchTimer.current);
        }
        const trimmed = (value || '').trim();
        if (trimmed.length < ADDRESS_SEARCH_MIN_CHARS) {
            addressSearchSeq.current += 1;
            setAddressOptions([]);
            setAddressSearching(false);
            return;
        }
        addressSearchTimer.current = setTimeout(() => {
            runAddressSearch(trimmed);
        }, ADDRESS_SEARCH_DEBOUNCE_MS);
    };

    const renderLookupStep = () => (
        <>
            <Form
                form={lookupForm}
                layout="vertical"
                onFinish={handleLookup}
                onValuesChange={handleLookupValuesChange}
            >
                <Text type="secondary" style={{display: 'block', marginBottom: 12}}>
                    {t.enterIdOrPhone}
                </Text>
                <Form.Item
                    name="identification_number"
                    label={t.customerIdNumber}
                >
                    <Input
                        size="large"
                        placeholder={t.customerIdNumber}
                        prefix={<IdcardOutlined style={{opacity: 0.4}}/>}
                        allowClear
                        inputMode="numeric"
                        pattern="[0-9]*"
                    />
                </Form.Item>
                <Form.Item
                    name="phone"
                    label={t.customerPhone}
                >
                    <Input
                        size="large"
                        placeholder={t.customerPhone}
                        prefix={<PhoneOutlined style={{opacity: 0.4}}/>}
                        allowClear
                        inputMode="tel"
                        type="tel"
                    />
                </Form.Item>
                <Flex justify="space-between" gap={8}>
                    <Button
                        icon={<UserAddOutlined/>}
                        onClick={handleCreateNewClient}
                        disabled={lookupLoading}
                    >
                        {t.createCustomer}
                    </Button>
                    <Button
                        type="primary"
                        htmlType="submit"
                        icon={<SearchOutlined/>}
                        loading={lookupLoading}
                    >
                        {t.search}
                    </Button>
                </Flex>
            </Form>

            {foundClients.length > 0 && (
                <>
                    <Divider/>
                    {foundClients.length > 1 && (
                        <Input
                            size="large"
                            allowClear
                            placeholder={t.filterClientsPlaceholder}
                            prefix={<SearchOutlined style={{opacity: 0.4}}/>}
                            value={foundClientsFilter}
                            onChange={(e) => setFoundClientsFilter(e.target.value)}
                            style={{marginBottom: 12}}
                        />
                    )}
                    <Flex vertical gap={12}>
                        {filteredFoundClients.length === 0 ? (
                            <Text type="secondary" style={{textAlign: 'center', padding: '12px 0'}}>
                                {t.noClientsMatchFilter}
                            </Text>
                        ) : (
                            filteredFoundClients.map((client, index) => (
                                <Card
                                    key={index}
                                    size="small"
                                    hoverable
                                    onClick={() => onSelect(client)}
                                    style={{borderColor: '#52c41a', borderRadius: 12}}
                                    styles={{body: {padding: 16}}}
                                >
                                    <Descriptions
                                        column={1}
                                        size="small"
                                        colon
                                        labelStyle={{width: 120, fontWeight: 500}}
                                    >
                                        <Descriptions.Item label={t.customerName}>
                                            {client.name || '—'}
                                        </Descriptions.Item>
                                        <Descriptions.Item label={t.customerAddress}>
                                            {client.address || '—'}
                                        </Descriptions.Item>
                                        <Descriptions.Item label={t.customerPhone}>
                                            {client.phone || '—'}
                                        </Descriptions.Item>
                                    </Descriptions>
                                </Card>
                            ))
                        )}
                    </Flex>
                </>
            )}
        </>
    );

    const renderCreateStep = () => (
        <>
            <Flex justify="start" style={{marginBottom: 12}}>
                <Button
                    type="text"
                    icon={<ArrowLeftOutlined/>}
                    onClick={() => setStep(STEP_LOOKUP)}
                    style={{paddingLeft: 0}}
                >
                    {t.backToSearch}
                </Button>
            </Flex>

            <Alert
                message={t.clientNotFoundCreate}
                type="info"
                showIcon
                style={{marginBottom: 16, borderRadius: 10}}
            />

            <Form
                form={createForm}
                layout="vertical"
                onFinish={handleCreate}
                initialValues={{is_phys: true, ...lookupSeed}}
            >
                <Form.Item
                    name="identification_number"
                    label={t.customerIdNumber}
                >
                    <Input
                        size="large"
                        placeholder={t.customerIdNumber}
                        prefix={<IdcardOutlined style={{opacity: 0.4}}/>}
                        inputMode="numeric"
                        pattern="[0-9]*"
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

                <Form.Item name="is_phys" label={t.isPhys}>
                    <Segmented
                        block
                        size="large"
                        options={[
                            {label: t.physicalPerson, value: true},
                            {label: t.legalEntity, value: false},
                        ]}
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

                <Flex gap={12}>
                    <Form.Item name="phone" label={t.customerPhone} style={{flex: 1}}>
                        <Input
                            size="large"
                            placeholder={t.customerPhone}
                            prefix={<PhoneOutlined style={{opacity: 0.4}}/>}
                            inputMode="tel"
                            type="tel"
                        />
                    </Form.Item>
                    <Form.Item name="phone_2" label={t.secondaryPhone} style={{flex: 1}}>
                        <Input
                            size="large"
                            placeholder={t.secondaryPhone}
                            prefix={<PhoneOutlined style={{opacity: 0.4}}/>}
                            inputMode="tel"
                            type="tel"
                        />
                    </Form.Item>
                </Flex>

                <Form.Item name="email" label={t.customerEmail}>
                    <Input size="large" placeholder={t.customerEmail}/>
                </Form.Item>

                <Divider style={{margin: '8px 0 16px'}}>
                    <Text type="secondary" style={{fontSize: 13}}>
                        <EnvironmentOutlined style={{marginRight: 6}}/>
                        {t.customerAddress}
                    </Text>
                </Divider>

                <Form.Item
                    name="address_line"
                    label={t.addressLine}
                    extra={t.addressSearchHint || t.clickMapToPickAddress}
                >
                    <AutoComplete
                        options={addressOptions.map((opt) => ({
                            value: opt.value,
                            lat: opt.lat,
                            lng: opt.lng,
                            label: (
                                <span style={{whiteSpace: 'normal', wordBreak: 'break-word'}}>
                                    {opt.label}
                                </span>
                            ),
                        }))}
                        onSearch={handleAddressSearch}
                        onSelect={(_, option) => {
                            if (
                                typeof option?.lat === 'number'
                                && typeof option?.lng === 'number'
                            ) {
                                setMapPosition({lat: option.lat, lng: option.lng});
                            }
                        }}
                        notFoundContent={
                            addressSearching
                                ? (t.addressSearching || t.search)
                                : null
                        }
                        filterOption={false}
                        allowClear
                    >
                        <Input
                            size="large"
                            placeholder={t.addressLine}
                            prefix={<EnvironmentOutlined style={{opacity: 0.4}}/>}
                            suffix={
                                resolvingAddress || addressSearching ? (
                                    <LoadingOutlined/>
                                ) : null
                            }
                        />
                    </AutoComplete>
                </Form.Item>

                <div style={{marginBottom: 16}}>
                    <AddressMapPicker
                        position={mapPosition}
                        onPositionChange={setMapPosition}
                        onAddressResolved={handleAddressResolved}
                        onResolvingChange={setResolvingAddress}
                    />
                </div>

                <Flex gap={8} justify="end">
                    <Button onClick={() => setStep(STEP_LOOKUP)}>
                        {t.back || 'Back'}
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
        </>
    );

    return (
        <Modal
            title={
                <Flex align="center" gap={8}>
                    <UserOutlined style={{fontSize: 18, color: '#1677ff'}}/>
                    <span style={{fontWeight: 600}}>
                        {step === STEP_LOOKUP ? t.lookupClient : t.createCustomer}
                    </span>
                </Flex>
            }
            open={open}
            onCancel={onClose}
            footer={null}
            width={580}
            styles={{body: {maxHeight: '75vh', overflowY: 'auto'}}}
            destroyOnClose
        >
            {step === STEP_LOOKUP ? renderLookupStep() : renderCreateStep()}
        </Modal>
    );
};

export default ClientLookupModal;

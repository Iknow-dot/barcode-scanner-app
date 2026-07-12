import React, {useEffect, useState} from 'react';
import {
    Button,
    Card,
    Divider,
    Flex,
    Form,
    Input,
    Popconfirm,
    Spin,
    Switch,
    Tag,
    Tooltip,
} from 'antd';
import {
    GlobalOutlined,
    LockOutlined,
    SaveOutlined,
    UserOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    KeyOutlined,
    CopyOutlined,
    ReloadOutlined,
} from '@ant-design/icons';
import {organizationService} from '../../api';
import useAppNotification from '../../hooks/useAppNotification';
import {useLanguage} from '../../i18n/LanguageContext';

const ExternalServiceSettings = () => {
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [hasPassword, setHasPassword] = useState(false);
    const [pushToken, setPushToken] = useState('');
    const [rotating, setRotating] = useState(false);
    const {notify, contextHolder} = useAppNotification();
    const {t} = useLanguage();

    useEffect(() => {
        const fetchSettings = async () => {
            setLoading(true);
            try {
                const result = await organizationService.getExternalService();
                if (result.success) {
                    form.setFieldsValue({
                        web_service_url: result.data.web_service_url,
                        web_service_username: result.data.web_service_username,
                    });
                    setHasPassword(result.data.has_password);
                    setPushToken(result.data.webhook_token || '');
                } else {
                    notify.error(t.error, t.externalServiceFetchError);
                }
            } finally {
                setLoading(false);
            }
        };
        fetchSettings();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleCopyToken = async () => {
        try {
            await navigator.clipboard.writeText(pushToken);
            notify.success(t.success, t.pushTokenCopied);
        } catch {
            notify.error(t.error, t.pushTokenCopyError);
        }
    };

    const handleRotateToken = async () => {
        setRotating(true);
        try {
            const result = await organizationService.rotateExternalServiceToken();
            if (result.success) {
                setPushToken(result.data.webhook_token);
                notify.success(t.success, t.pushTokenRotated);
            } else {
                notify.error(t.error, result.error || t.pushTokenRotateError);
            }
        } finally {
            setRotating(false);
        }
    };

    const handleSubmit = async (values) => {
        setSaving(true);
        try {
            const payload = {
                web_service_url: values.web_service_url,
                web_service_username: values.web_service_username || '',
            };

            if (values.clear_password) {
                payload.clear_password = true;
            } else if (values.web_service_password) {
                payload.web_service_password = values.web_service_password;
            }

            const result = await organizationService.updateExternalService(payload);
            if (result.success) {
                notify.success(t.success, t.externalServiceUpdated);
                setHasPassword(result.data.has_password);
                form.setFieldsValue({
                    web_service_password: '',
                    clear_password: false,
                });
            } else {
                notify.error(t.error, result.error || t.externalServiceUpdateError);
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            {contextHolder}
            <Spin spinning={loading}>
                <Card
                    style={{maxWidth: 600, margin: '0 auto'}}
                    styles={{body: {paddingTop: 24}}}
                >
                    <Form
                        form={form}
                        layout="vertical"
                        size="large"
                        onFinish={handleSubmit}
                    >
                        <Form.Item
                            label={t.externalServiceUrl}
                            name="web_service_url"
                            rules={[
                                {required: true, message: t.externalServiceUrlRequired},
                            ]}
                        >
                            <Input
                                prefix={<GlobalOutlined style={{opacity: 0.4}}/>}
                                placeholder="https://example.com/api"
                            />
                        </Form.Item>

                        <Divider style={{margin: '8px 0 16px'}}>
                            <Flex align="center" gap={6} style={{opacity: 0.7, fontSize: 13}}>
                                <LockOutlined/>
                                {t.webService} — {t.externalServiceUsername} / {t.externalServicePassword}
                            </Flex>
                        </Divider>

                        <Form.Item
                            label={t.externalServiceUsername}
                            name="web_service_username"
                        >
                            <Input
                                prefix={<UserOutlined style={{opacity: 0.4}}/>}
                                autoComplete="off"
                            />
                        </Form.Item>

                        <Flex gap={16} align="flex-start">
                            <Form.Item
                                style={{flex: 1}}
                                label={
                                    <Flex align="center" gap={8}>
                                        {t.externalServicePassword}
                                        {hasPassword ? (
                                            <Tag
                                                icon={<CheckCircleOutlined/>}
                                                color="success"
                                                style={{fontSize: 11, marginLeft: 4}}
                                            >
                                                {t.passwordIsSet}
                                            </Tag>
                                        ) : (
                                            <Tag
                                                icon={<CloseCircleOutlined/>}
                                                color="default"
                                                style={{fontSize: 11, marginLeft: 4}}
                                            >
                                                {t.passwordNotSet}
                                            </Tag>
                                        )}
                                    </Flex>
                                }
                                name="web_service_password"
                                extra={
                                    <span style={{fontSize: 12, opacity: 0.5}}>
                                        {t.leaveEmptyPassword}
                                    </span>
                                }
                            >
                                <Input.Password
                                    prefix={<LockOutlined style={{opacity: 0.4}}/>}
                                    autoComplete="new-password"
                                />
                            </Form.Item>
                            <Form.Item
                                label={t.clearPassword}
                                name="clear_password"
                                valuePropName="checked"
                            >
                                <Switch/>
                            </Form.Item>
                        </Flex>

                        <Form.Item style={{marginTop: 8, marginBottom: 0}}>
                            <Button
                                block
                                type="primary"
                                htmlType="submit"
                                loading={saving}
                                icon={<SaveOutlined/>}
                                style={{height: 44, fontWeight: 600}}
                            >
                                {t.save}
                            </Button>
                        </Form.Item>
                    </Form>

                    <Divider style={{margin: '24px 0 16px'}}>
                        <Flex align="center" gap={6} style={{opacity: 0.7, fontSize: 13}}>
                            <KeyOutlined/>
                            {t.pushToken}
                        </Flex>
                    </Divider>

                    <p style={{fontSize: 12, opacity: 0.6, marginTop: 0}}>{t.pushTokenHelp}</p>

                    <Input
                        readOnly
                        value={pushToken}
                        prefix={<KeyOutlined style={{opacity: 0.4}}/>}
                        addonAfter={
                            <Tooltip title={t.pushTokenCopy}>
                                <CopyOutlined style={{cursor: 'pointer'}} onClick={handleCopyToken}/>
                            </Tooltip>
                        }
                    />

                    <Popconfirm
                        title={t.pushTokenRotate}
                        description={t.pushTokenRotateWarning}
                        okText={t.pushTokenRotate}
                        cancelText={t.cancel}
                        okButtonProps={{danger: true}}
                        onConfirm={handleRotateToken}
                    >
                        <Button
                            danger
                            ghost
                            loading={rotating}
                            icon={<ReloadOutlined/>}
                            style={{marginTop: 12}}
                        >
                            {t.pushTokenRotate}
                        </Button>
                    </Popconfirm>
                </Card>
            </Spin>
        </>
    );
};

export default ExternalServiceSettings;

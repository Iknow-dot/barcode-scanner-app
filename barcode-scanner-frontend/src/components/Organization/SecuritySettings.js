import React, {useEffect, useState} from 'react';
import {Button, Card, Form, InputNumber, Spin} from 'antd';
import {SaveOutlined} from '@ant-design/icons';
import {organizationService} from '../../api';
import useAppNotification from '../../hooks/useAppNotification';
import {useLanguage} from '../../i18n/LanguageContext';

const SecuritySettings = () => {
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const {notify, contextHolder} = useAppNotification();
    const {t} = useLanguage();

    useEffect(() => {
        const fetchSettings = async () => {
            setLoading(true);
            try {
                const result = await organizationService.getSecuritySettings();
                if (result.success) {
                    form.setFieldsValue({
                        session_timeout_minutes: result.data.session_timeout_minutes,
                    });
                } else {
                    notify.error(t.error, t.securityFetchError);
                }
            } finally {
                setLoading(false);
            }
        };
        fetchSettings();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSubmit = async (values) => {
        setSaving(true);
        try {
            const result = await organizationService.updateSecuritySettings({
                session_timeout_minutes: values.session_timeout_minutes ?? null,
            });
            if (result.success) {
                notify.success(t.success, t.sessionTimeoutUpdated);
                form.setFieldsValue({
                    session_timeout_minutes: result.data.session_timeout_minutes,
                });
            } else {
                notify.error(t.error, result.error || t.error);
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
                            label={t.sessionTimeout}
                            name="session_timeout_minutes"
                            extra={<span style={{fontSize: 12, opacity: 0.5}}>{t.sessionTimeoutHint}</span>}
                        >
                            <InputNumber style={{width: '100%'}} min={30} max={43200}
                                         placeholder={t.sessionTimeoutDefault}/>
                        </Form.Item>

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
                </Card>
            </Spin>
        </>
    );
};

export default SecuritySettings;

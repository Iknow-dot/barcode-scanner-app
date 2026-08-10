import React, {useContext, useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {authService} from '../../api';
import AuthContext from '../Auth/AuthContext';
import {Alert, Button, Card, Dropdown, Flex, Form, Input, Layout, Space, Spin, theme, Typography} from "antd";
import {Content} from "antd/es/layout/layout";
import {GlobalOutlined, LockOutlined, LoginOutlined, UserOutlined} from "@ant-design/icons";
import {useLanguage} from '../../i18n/LanguageContext';

const {Title, Text} = Typography;

const Login = () => {
    const [loading, setLoading] = useState(false);
    const {login, authData} = useContext(AuthContext);
    const navigate = useNavigate();
    const {t, language, switchLanguage} = useLanguage();
    const {
        token: {colorBgContainer, borderRadiusLG, colorBgBase, colorBgElevated, colorBorderSecondary},
    } = theme.useToken();
    const isDarkMode = colorBgBase === "#000";
    const [error, setError] = React.useState(null);

    useEffect(() => {
        if (authData?.token) {
            const role = authData.role;
            navigate(role === 'internal_admin' || role === 'company_admin' ? '/system-admin-dashboard' : '/dashboard');
        }
    }, [authData, navigate]);

    const handleSubmit = async (users) => {
        setLoading(true);
        setError(null);
        const {username, password} = users;

        if (!username || !password) {
            setLoading(false);
            return;
        }

        const result = await authService.login(username, password);

        if (!result.success) {
            const errorMessages = {
                'IP_NOT_ALLOWED': t.ipNotAllowed,
                'DEVICE_NOT_ALLOWED': t.deviceNotAllowed,
            };

            const errorCode = result.code;
            setError(errorMessages[errorCode] || result.error || t.invalidCredentials);
            setLoading(false);
            return;
        }

        const {access_token, refresh_token, role, organization_id, organization_name, warehouses, user, gift_marking_enabled, product_catalog_enabled} = result.data;

        // Set the token for subsequent requests
        authService.setAuthToken(access_token);

        login(access_token, refresh_token, role, organization_id, organization_name, warehouses, user, gift_marking_enabled, product_catalog_enabled);
        navigate(role === 'internal_admin' || role === 'company_admin' ? '/system-admin-dashboard' : '/dashboard');

        setLoading(false);
    };

    const langItems = [
        {
            key: 'ka',
            label: '🇬🇪 ქართული',
            onClick: () => switchLanguage('ka'),
        },
        {
            key: 'en',
            label: '🇬🇧 English',
            onClick: () => switchLanguage('en'),
        },
    ];

    return (
        <Layout className="login-page" style={{
            background: isDarkMode
                ? 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #0a0a0a 100%)'
                : 'linear-gradient(135deg, #f0f5ff 0%, #e6f0ff 50%, #f5f5f5 100%)',
        }}>
            <Flex justify="flex-end" style={{padding: '16px 24px 0'}}>
                <Dropdown menu={{items: langItems, selectedKeys: [language]}}>
                    <Button type="text" icon={<GlobalOutlined/>} size="small"
                            style={{opacity: 0.7}}>
                        {language === 'ka' ? 'ქარ' : 'EN'}
                    </Button>
                </Dropdown>
            </Flex>

            <Flex vertical align="center" justify="center" style={{flex: 1, padding: '0 16px'}}>
                <img
                    src={isDarkMode ? "/logo-dark.png" : "/logo-light.png"}
                    alt="iFlow"
                    className="login-logo"
                />

                <Card
                    className="login-card"
                    style={{
                        width: '100%',
                        maxWidth: 400,
                        borderRadius: 16,
                        border: `1px solid ${colorBorderSecondary}`,
                        boxShadow: isDarkMode
                            ? '0 8px 32px rgba(0, 0, 0, 0.4)'
                            : '0 8px 32px rgba(0, 0, 0, 0.08)',
                    }}
                    styles={{body: {padding: '32px 28px'}}}
                >
                    <div className="login-title">{t.login}</div>
                    <div className="login-subtitle">{t.loginSubtitle || (language === 'ka' ? 'შეიყვანეთ თქვენი მონაცემები' : 'Enter your credentials to continue')}</div>

                    <Form
                        layout="vertical"
                        autoComplete="on"
                        onFinish={handleSubmit}
                        size="large"
                    >
                        {error && (
                            <Alert
                                message={error}
                                type="error"
                                style={{marginBottom: 20, borderRadius: 10}}
                                showIcon
                                closable
                                onClose={() => setError(null)}
                            />
                        )}
                        <Form.Item
                            name="username"
                            rules={[{required: true, message: t.usernameRequired}]}
                        >
                            <Input
                                prefix={<UserOutlined style={{opacity: 0.45}}/>}
                                placeholder={t.username}
                                style={{height: 48, borderRadius: 10}}
                            />
                        </Form.Item>

                        <Form.Item
                            name="password"
                            rules={[{required: true, message: t.passwordRequired}]}
                        >
                            <Input.Password
                                prefix={<LockOutlined style={{opacity: 0.45}}/>}
                                placeholder={t.password}
                                style={{height: 48, borderRadius: 10}}
                            />
                        </Form.Item>

                        <Form.Item style={{marginBottom: 0, marginTop: 8}}>
                            <Button
                                type="primary"
                                htmlType="submit"
                                loading={loading}
                                aria-label={t.login}
                                icon={<LoginOutlined style={{fontSize: 22}}/>}
                                style={{
                                    width: "100%",
                                    height: 48,
                                    borderRadius: 10,
                                    fontWeight: 600,
                                }}
                            />
                        </Form.Item>
                    </Form>
                </Card>
            </Flex>

            <Flex justify="center" style={{padding: '24px 0', opacity: 0.4}}>
                <Text style={{fontSize: 12}}>{t.footer}</Text>
            </Flex>
        </Layout>
    );
};

export default Login;

import React, {useContext, useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {authService} from '../../api';
import AuthContext from '../Auth/AuthContext';
import {Alert, Button, Dropdown, Flex, Form, Input, Layout, Space, Spin, theme} from "antd";
import {Content} from "antd/es/layout/layout";
import {GlobalOutlined, LockOutlined, UserOutlined} from "@ant-design/icons";
import {useLanguage} from '../../i18n/LanguageContext';

const Login = () => {
    const [loading, setLoading] = useState(false);
    const {login, authData} = useContext(AuthContext);
    const navigate = useNavigate();
    const {t, language, switchLanguage} = useLanguage();
    const {
        token: {colorBgContainer, borderRadiusLG, colorBgBase},
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
            };

            const errorCode = result.code;
            setError(errorMessages[errorCode] || result.error || t.invalidCredentials);
            setLoading(false);
            return;
        }

        const {access_token, refresh_token, role, organization_id, organization_name, warehouses, user} = result.data;

        // Set the token for subsequent requests
        authService.setAuthToken(access_token);

        login(access_token, refresh_token, role, organization_id, organization_name, warehouses, user);
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
        <>
            <Layout style={{minHeight: "100vh"}}>
                <Flex justify="flex-end" style={{padding: '16px 24px 0'}}>
                    <Dropdown menu={{items: langItems, selectedKeys: [language]}}>
                        <Button type="text" icon={<GlobalOutlined/>}>
                            {language === 'ka' ? 'ქარ' : 'EN'}
                        </Button>
                    </Dropdown>
                </Flex>
                <img
                    src={isDarkMode ? "/logo-dark.png" : "/logo-light.png"}
                    alt="iFlow"
                    style={{display: "block", width: "200px", margin: "auto"}}
                />
                <Layout>
                    <Content
                        style={{
                            flex: "none",
                            padding: 24,
                            margin: "0 auto",
                            width: "350px",
                            background: colorBgContainer,
                            borderRadius: borderRadiusLG,
                        }}
                    >
                        <Form
                            layout="vertical"
                            initialValues={{remember: true}}
                            autoComplete="on"
                            onFinish={handleSubmit}
                        >
                            {error && (
                                <Alert message={error} type="error" style={{marginBottom: 24}} showIcon/>
                            )}
                            <Form.Item
                                label={t.username}
                                name="username"
                                rules={[{required: true, message: t.usernameRequired}]}
                            >
                                <Input prefix={<UserOutlined/>}/>
                            </Form.Item>

                            <Form.Item
                                label={t.password}
                                name="password"
                                rules={[{required: true, message: t.passwordRequired}]}
                            >
                                <Input.Password prefix={<LockOutlined/>}/>
                            </Form.Item>

                            <Spin spinning={loading}>
                                <Form.Item label={null}>
                                    <Button type="primary" htmlType="submit" style={{width: "100%"}}>
                                        {t.login}
                                    </Button>
                                </Form.Item>
                            </Spin>
                        </Form>
                    </Content>
                </Layout>
            </Layout>
        </>
    );
};

export default Login;

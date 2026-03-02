import React, {useContext, useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {authService, userService} from '../../api';
import AuthContext from '../Auth/AuthContext';
import {Alert, Button, Flex, Form, Input, Layout, Spin, theme} from "antd";
import {Content} from "antd/es/layout/layout";
import {LockOutlined, UserOutlined} from "@ant-design/icons";

const Login = () => {
    const [loading, setLoading] = useState(false);
    const {login, authData} = useContext(AuthContext);
    const navigate = useNavigate();
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
            setError(result.error || "მომხმარებელი ან პაროლი არასწორია");
            setLoading(false);
            return;
        }

        const {access_token, refresh_token, role, organization_id, organization_name, warehouses, user} = result.data;

        // Set the token for subsequent requests
        authService.setAuthToken(access_token);

        if (role === 'company_user') {
            // For company users, check IP allowance
            const ipResult = await userService.getClientIp();
            if (ipResult.success) {
                login(access_token, refresh_token, role, organization_id, organization_name, warehouses, user);
                navigate('/dashboard');
            } else {
                setError("თქვენი IP მისამართი არ არის დაშვებული");
            }
        } else {
            login(access_token, refresh_token, role, organization_id, organization_name, warehouses, user);
            navigate(role === 'internal_admin' || role === 'company_admin' ? '/system-admin-dashboard' : '/dashboard');
        }

        setLoading(false);
    };

    return (
        <>
            <Layout style={{minHeight: "100vh"}}>
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
                                label="მომხმარებელი სახელი"
                                name="username"
                                rules={[{required: true, message: 'Please input your username!'}]}
                            >
                                <Input prefix={<UserOutlined/>}/>
                            </Form.Item>

                            <Form.Item
                                label="პაროლი"
                                name="password"
                                rules={[{required: true, message: 'Please input your password!'}]}
                            >
                                <Input.Password prefix={<LockOutlined/>}/>
                            </Form.Item>

                            <Spin spinning={loading}>
                                <Form.Item label={null}>
                                    <Button type="primary" htmlType="submit" style={{width: "100%"}}>
                                        შესვლა
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

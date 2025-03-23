import React, {useState, useContext, useEffect} from 'react';
import {useNavigate} from 'react-router-dom';
import api, {getClientIp} from '../../api';  // Make sure getClientIp is correctly imported
import AuthContext from '../Auth/AuthContext';
import {Button, Checkbox, Form, Input, Layout} from "antd";

const Login = () => {
  const {login, token, userRole} = useContext(AuthContext);
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect if already logged in
    if (token) {
      navigate(userRole === 'system_admin' || userRole === 'admin' ? '/system-admin-dashboard' : '/dashboard');
    }
  }, [token, userRole, navigate]);

  const handleSubmit = async (users) => {
    const {username, password} = users;

    if (!username || !password) {
      return;
    }

    try {
      const response = await api.post('/auth/login', {username, password});
      const {access_token, role, organization_id, userId} = response.data;
      // Set the token for subsequent requests before making additional API calls
      api.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;

      if (role === 'user') {
        const ipData = await getClientIp();
        if (ipData.success && ipData.ip.allowed) {
          login(access_token, role, organization_id);
          navigate('/dashboard');
        } else {
        }
      } else {
        login(access_token, role, organization_id);
        navigate(role === 'system_admin' || role === 'admin' ? '/system-admin-dashboard' : '/dashboard');
      }
    } catch (error) {
      const errorMessage = error.response?.status === 401
          ? 'მომხმარებლის სახელი ან პაროლი არასწორია'
          : 'An error occurred. Please try again later.';
    }
  };

  return (
      <>
        <Layout>
          <img
            src="/iflow-logo.png"
            alt="iFlow"
            style={{
              display: "block",
              marginLeft: "auto",
              marginRight: "auto",
              width: "50%",
              marginBottom: 20
            }}
            />
          <Form
              name="basic"
              labelCol={{
                span: 8,
              }}
              wrapperCol={{
                span: 16,
              }}
              style={{
                maxWidth: 600,
                justifyContent: "center",
              }}
              initialValues={{
                remember: true,
              }}
              autoComplete="on"
              onFinish={handleSubmit}
          >
            <Form.Item
                label="Username"
                name="username"
                rules={[
                  {
                    required: true,
                    message: 'Please input your username!',
                  },
                ]}
            >
              <Input/>
            </Form.Item>

            <Form.Item
                label="Password"
                name="password"
                rules={[
                  {
                    required: true,
                    message: 'Please input your password!',
                  },
                ]}
            >
              <Input.Password/>
            </Form.Item>

            <Form.Item name="remember" valuePropName="checked" label={null}>
              <Checkbox>Remember me</Checkbox>
            </Form.Item>

            <Form.Item label={null}>
              <Button type="primary" htmlType="submit">
                Submit
              </Button>
            </Form.Item>
          </Form>
        </Layout>
      </>
  );
};

export default Login;
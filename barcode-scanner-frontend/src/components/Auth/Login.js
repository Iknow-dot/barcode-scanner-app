import React, {useContext, useEffect} from 'react';
import {useNavigate} from 'react-router-dom';
import api, {getClientIp} from '../../api';  // Make sure getClientIp is correctly imported
import AuthContext from '../Auth/AuthContext';
import {Alert, Button, Form, Input, Layout, theme} from "antd";
import {Content} from "antd/es/layout/layout";

const Login = () => {
  const {login, token, userRole} = useContext(AuthContext);
  const navigate = useNavigate();
  const {
    token: {colorBgContainer, borderRadiusLG},
  } = theme.useToken();
  const [error, setError] = React.useState("");

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
          setError("თქვენი IP მისამართი არ არის დაშვებული");
        }
      } else {
        login(access_token, role, organization_id);
        navigate(role === 'system_admin' || role === 'admin' ? '/system-admin-dashboard' : '/dashboard');
      }
    } catch (error) {
      setError("მომხმარებელი ან პაროლი არასწორია");
    }
  };


  return (
      <>
        <Layout style={{
          minHeight: "100vh",
        }}>
          <img
              src="/iflow-logo.png"
              alt="iFlow"
              style={{
                display: "block",
                width: "200px",
                margin: "auto",
              }}
          />
          <Layout>
            <Content
                style={{
                  flex: "none",
                  padding: 24,
                  margin: "0 auto",
                  width: "50%",
                  background: colorBgContainer,
                  borderRadius: borderRadiusLG,
                }}
            >
              <Form
                  layout="vertical"
                  initialValues={{
                    remember: true,
                  }}
                  autoComplete="on"
                  onFinish={handleSubmit}
              >
                {error && (
                    <Alert message={error}
                           type="error"
                           style={{marginBottom: 24}}
                           showIcon
                    />
                )}
                <Form.Item
                    label="მომხმარებელი"
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
                    label="პაროლი"
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

                <Form.Item label={null}>
                  <Button type="primary" htmlType="submit">
                    შესვლა
                  </Button>
                </Form.Item>
              </Form>
            </Content>
          </Layout>
        </Layout>
      </>
  );
};

export default Login;
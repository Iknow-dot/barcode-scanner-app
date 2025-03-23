import React, {useContext, useEffect, useState} from 'react';
import {BrowserRouter as Router, Routes, Route, Navigate} from 'react-router-dom';
import AuthContext, {AuthProvider} from './components/Auth/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import Dashboard from './components/UserDashboard/UserDashboard';
import Organization from './components/Organization/OrganizationList';
import Warehouse from './components/Warehouse/WarehouseList';
import Login from './components/Auth/Login';
import Logout from './components/Auth/Logout';
import SystemAdminDashboard from './components/SystemAdminDashboard/SystemAdminDashboard';
import {Breadcrumb, ConfigProvider, FloatButton, Layout, Menu, theme, App as AntdApp, Button, notification} from "antd";
import {Content, Header, Footer} from "antd/es/layout/layout";
import Sider from "antd/es/layout/Sider";
import {LaptopOutlined, LogoutOutlined, MoonOutlined, NotificationOutlined, UserOutlined} from "@ant-design/icons";
import SubNavContext, {SubNavProvider} from "./contexts/SubNavContext";


const MainContentView = ({children}) => {
  const {subNav} = useContext(SubNavContext);
  const [isDark, setIsDark] = useState(localStorage.getItem("theme") === "dark");

  const {
    token: {colorBgContainer, borderRadiusLG},
  } = theme.useToken();
  const {logout} = useContext(AuthContext);

  return (
      <Layout style={{minHeight: "100vh"}}>
        <FloatButton
            onClick={() => {
              const newTheme = !isDark;
              setIsDark(!isDark);
              localStorage.setItem("theme", newTheme ? "dark" : "light");// Save theme preference
            }}
            shape="circle"
            style={{insetInlineEnd: 24}}
            icon={<MoonOutlined/>}
        />
        <Header style={{display: 'flex', alignItems: 'center'}}>
          <img
              src="/iflow-logo.png"
              alt="Logo"
              width="100"
          />

          <Button variant="solid"
                  color="danger"
                  className="float-right"
                  style={{marginLeft: 'auto'}}
                  onClick={logout}>
            <LogoutOutlined/> Log Out
          </Button>
        </Header>
        <Breadcrumb
            style={{padding: '16px 48px'}}
            items={[
              {title: 'Home'},
              {title: 'Dashboard'},
            ]}
        />
        <div style={{padding: '0 48px'}}>
          <Layout
              style={{padding: '24px 0', background: colorBgContainer, borderRadius: borderRadiusLG}}
          >
            <Sider style={{background: colorBgContainer}} width={200}>
              <Menu
                  mode="inline"
                  defaultSelectedKeys={'3'}
                  style={{height: '100%'}}
                  items={subNav}
              />
            </Sider>
            <Content style={{padding: '0 24px', minHeight: 280}}>
              {children}
            </Content>
          </Layout>
        </div>
        <Footer style={{textAlign: 'center'}}>
          <p>© 2024 iFlow.ge Powered by IKnow LTD. All rights reserved.</p>
        </Footer>
      </Layout>
  );
};
const NotificationContextHolder = () => {
  const [_, contextHolder] = notification.useNotification();
  return contextHolder;
};

const AppContent = () => {
  const [isDark, setIsDark] = useState(localStorage.getItem("theme") === "dark");

  return (
      <ConfigProvider theme={{algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm}}>
        <AntdApp>
          <NotificationContextHolder/>
          <Routes>
            {/* Public route */}
            <Route path="/login" element={<Login/>}/>

            {/* Private routes for different roles */}
            <Route
                path="/dashboard"
                element={
                  <PrivateRoute allowedRoles={['admin', 'user']}>
                    <MainContentView>
                      <Dashboard/>
                    </MainContentView>
                  </PrivateRoute>
                }
            />
            <Route
                path="/organizations"
                element={
                  <PrivateRoute allowedRoles={['admin', 'system_admin']}>
                    <MainContentView>
                      <Organization/>
                    </MainContentView>
                  </PrivateRoute>
                }
            />
            <Route
                path="/warehouses"
                element={
                  <PrivateRoute allowedRoles={['admin', 'system_admin']}>
                    <MainContentView>
                      <Warehouse/>
                    </MainContentView>
                  </PrivateRoute>
                }
            />
            <Route
                path="/system-admin-dashboard"
                element={
                  <PrivateRoute allowedRoles={['admin', 'system_admin']}>
                    <MainContentView>
                      <SystemAdminDashboard/>
                    </MainContentView>
                  </PrivateRoute>
                }
            />
            <Route
                path="/logout"
                element={
                  <PrivateRoute allowedRoles={['admin', 'user', 'system_admin']}>
                    <Logout/>
                  </PrivateRoute>
                }
            />

            {/* Redirect to login as the default route */}
            <Route path="/" element={<Navigate to="/login"/>}/>
          </Routes>
        </AntdApp>
      </ConfigProvider>
  );
};

const App = () => {
  return (
      <AuthProvider>
        <SubNavProvider>
          <Router>
            <AppContent/>
          </Router>
        </SubNavProvider>
      </AuthProvider>
  );
};

export default App;

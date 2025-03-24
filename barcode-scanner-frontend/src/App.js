import React, {useContext, useState} from 'react';
import {BrowserRouter as Router, Routes, Route, Navigate} from 'react-router-dom';
import AuthContext, {AuthProvider} from './components/Auth/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import Dashboard from './components/UserDashboard/UserDashboard';
import Organization from './components/Organization/OrganizationList';
import Warehouse from './components/Warehouse/WarehouseList';
import Login from './components/Auth/Login';
import Logout from './components/Auth/Logout';
import SystemAdminDashboard from './components/SystemAdminDashboard/SystemAdminDashboard';
import {
  ConfigProvider,
  FloatButton,
  Layout,
  Menu,
  theme,
  App as AntdApp,
  Space,
  Dropdown
} from "antd";
import {Content, Header, Footer} from "antd/es/layout/layout";
import Sider from "antd/es/layout/Sider";
import {LogoutOutlined, MoonOutlined, UserOutlined} from "@ant-design/icons";
import SubNavContext, {SubNavProvider} from "./contexts/SubNavContext";
import "antd/dist/reset.css";


const MainContentView = ({children}) => {
  const {authData} = useContext(AuthContext);
  const {subNav} = useContext(SubNavContext);
  const {
    token: {colorBgContainer, borderRadiusLG, colorText, colorBgBase},
  } = theme.useToken();
  const isDarkMode = colorBgBase === "#000";
  const {logout} = useContext(AuthContext);
  const items = [
    {
      key: '1',
      icon: <LogoutOutlined/>,
      label: "გასვლა",
      danger: true,
      onClick: logout
    }
  ];

  return (
      <Layout style={{minHeight: "100vh"}}>
        <Header style={{
          display: 'flex',
          alignItems: 'center',
          color: colorText,
          background: colorBgContainer,
        }}>
          <img
              src={isDarkMode ? "logo-dark.png" : "logo-light.png"}
              alt="Logo"
              width="100"
          />

          <div style={{marginLeft: 'auto'}}>
            <Dropdown menu={{items}}>
              <Space style={{cursor: "pointer"}}>
                {authData?.role}
                <UserOutlined/>
              </Space>
            </Dropdown>
          </div>


        </Header>
        <div style={{padding: '48px'}}>
          <Layout
              style={{padding: '24px 0', background: colorBgContainer, borderRadius: borderRadiusLG}}
          >
            {subNav && (
                <Sider style={{background: colorBgContainer}} width={200}>
                  <Menu
                      mode="inline"
                      defaultSelectedKeys={authData?.role === "system_admin" ? ['1'] : ['2']}
                      style={{height: '100%'}}
                      items={subNav}
                  />
                </Sider>
            )}
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


const AppContent = () => {
  const [isDark, setIsDark] = useState(localStorage.getItem("theme") === "dark");
  const toggleTheme = () => {
    document.body.classList.add("theme-transition"); // Add transition class
    const newTheme = !isDark;
    setIsDark(!isDark);
    localStorage.setItem("theme", newTheme ? "dark" : "light");
    setTimeout(() => {
      document.body.classList.remove("theme-transition"); // Remove after animation
    }, 1000); // Match CSS animation duration
  };
  return (
      <ConfigProvider theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm
      }}>
        <AntdApp>
          <FloatButton
              onClick={toggleTheme}
              shape="circle"
              style={{insetInlineEnd: 24}}
              icon={<MoonOutlined/>}
          />
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

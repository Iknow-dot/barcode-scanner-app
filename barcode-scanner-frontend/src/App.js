import React, {useContext, useEffect, useState} from 'react';
import {BrowserRouter as Router, Routes, Route, Navigate, Link} from 'react-router-dom';
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
    Dropdown, Grid, Flex, Avatar
} from "antd";
import {Content, Header, Footer} from "antd/es/layout/layout";
import Sider from "antd/es/layout/Sider";
import {LogoutOutlined, MoonOutlined, UserOutlined} from "@ant-design/icons";
import SubNavContext, {SubNavProvider} from "./contexts/SubNavContext";
import "antd/dist/reset.css";

const {useBreakpoint} = Grid;

const MainContentView = ({children}) => {
    const screens = useBreakpoint()
    const {authData} = useContext(AuthContext);
    const {subNav} = useContext(SubNavContext);
    const [siderCollapsed, setSiderCollapsed] = useState(!subNav);
    const {
        token: {colorBgContainer, borderRadiusLG, colorText, colorBgBase},
    } = theme.useToken();
    const isDarkMode = colorBgBase === "#000";
    const {logout} = useContext(AuthContext);

    // Sync collapsed state when subNav changes (e.g. navigating between pages)
    useEffect(() => {
        setSiderCollapsed(!subNav);
    }, [subNav]);
    const userIcon = (
        <Avatar style={{cursor: "pointer", backgroundColor: "#0765c2"}} size="large">
            {authData?.role?.charAt(0).toUpperCase()}
        </Avatar>
    );

    const items = [
        {
            key: '0',
            icon: (
                <Avatar style={{backgroundColor: "#0765c2"}} size="large">
                    {authData?.role?.charAt(0).toUpperCase()}
                </Avatar>
            ),
            label: authData?.role,
        },
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
            {screens.lg && (
                <Sider
                    breakpoint="lg"
                    theme={isDarkMode ? "dark" : "light"}
                    collapsible={!!subNav}
                    collapsed={siderCollapsed}
                    onCollapse={(collapsed) => setSiderCollapsed(collapsed)}
                >
                    <Link to={window.location.href}>
                        <img
                            src={isDarkMode ? "logo-dark.png" : "logo-light.png"}
                            alt="Logo"
                            width="75%"
                            style={{
                                margin: "16px auto",
                                display: "block",
                            }}
                        />
                    </Link>
                    <Menu theme={isDarkMode ? "dark" : "light"}
                          mode="inline"
                          defaultSelectedKeys={authData?.role === "internal_admin" ? ['1'] : ['2']}
                          items={subNav}
                    />
                </Sider>
            )}
            <Layout>
                <Header style={{padding: "0 24px", background: colorBgContainer}}>
                    {!screens.lg && (
                        <Flex>
                            <Link to={window.location.href}>
                                <img
                                    src={isDarkMode ? "logo-dark.png" : "logo-light.png"}
                                    alt="Logo"
                                    width="75px"
                                />
                            </Link>
                            {authData?.organization_name && (
                                <span style={{
                                    fontSize: 14,
                                    fontWeight: 500,
                                    color: colorText,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    alignSelf: 'center',
                                    marginLeft: 8,
                                    maxWidth: 120,
                                }}>
                                    {authData.organization_name}
                                </span>
                            )}
                            <Menu
                                style={{
                                    flex: 1,
                                    background: "transparent",
                                }}
                                theme={isDarkMode ? "dark" : "light"}
                                mode="horizontal"
                                defaultSelectedKeys={authData?.role === "internal_admin" ? ['1'] : ['2']}
                                items={subNav}
                            />
                            <Space style={{float: 'right'}}>
                                <Dropdown menu={{items}}>
                                    {userIcon}
                                </Dropdown>
                            </Space>
                        </Flex>
                    )}
                    {screens.lg && (
                        <Flex justify="space-between" align="center" style={{height: '100%'}}>
                            <span style={{fontSize: 16, fontWeight: 500, color: colorText}}>
                                {authData?.organization_name || ''}
                            </span>
                            <Space>
                                <Dropdown menu={{items}}>
                                    {userIcon}
                                </Dropdown>
                            </Space>
                        </Flex>
                    )}
                </Header>
                <Content style={{margin: '24px 16px 0'}}>
                    <div
                        style={{
                            padding: 24,
                            minHeight: 360,
                            background: colorBgContainer,
                            borderRadius: borderRadiusLG,
                        }}
                    >
                        {children}
                    </div>
                </Content>
                <Footer style={{textAlign: 'center'}}>
                    <p>© 2024 iFlow.ge Powered by IKnow LTD. All rights reserved.</p>
                </Footer>
            </Layout>

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
                            <PrivateRoute allowedRoles={['company_admin', 'company_user']}>
                                <MainContentView>
                                    <Dashboard/>
                                </MainContentView>
                            </PrivateRoute>
                        }
                    />
                    <Route
                        path="/organizations"
                        element={
                            <PrivateRoute allowedRoles={['company_admin', 'internal_admin']}>
                                <MainContentView>
                                    <Organization/>
                                </MainContentView>
                            </PrivateRoute>
                        }
                    />
                    <Route
                        path="/warehouses"
                        element={
                            <PrivateRoute allowedRoles={['company_admin', 'internal_admin']}>
                                <MainContentView>
                                    <Warehouse/>
                                </MainContentView>
                            </PrivateRoute>
                        }
                    />
                    <Route
                        path="/system-admin-dashboard"
                        element={
                            <PrivateRoute allowedRoles={['company_admin', 'internal_admin']}>
                                <MainContentView>
                                    <SystemAdminDashboard/>
                                </MainContentView>
                            </PrivateRoute>
                        }
                    />
                    <Route
                        path="/logout"
                        element={
                            <PrivateRoute allowedRoles={['company_admin', 'company_user', 'internal_admin']}>
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

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
    Layout,
    Menu,
    theme,
    App as AntdApp,
    Space,
    Dropdown, Grid, Flex, Avatar, Button
} from "antd";
import {Content, Header, Footer} from "antd/es/layout/layout";
import Sider from "antd/es/layout/Sider";
import {GlobalOutlined, LogoutOutlined, MoonOutlined, SunOutlined, UserOutlined} from "@ant-design/icons";
import SubNavContext, {SubNavProvider} from "./contexts/SubNavContext";
import {LanguageProvider, useLanguage} from "./i18n/LanguageContext";
import "antd/dist/reset.css";

const {useBreakpoint} = Grid;

const LanguageSwitcher = () => {
    const {language, switchLanguage, t} = useLanguage();

    const items = [
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
        <Dropdown menu={{items, selectedKeys: [language]}}>
            <Button type="text" icon={<GlobalOutlined/>} size="small"
                    style={{borderRadius: 8, fontWeight: 500}}>
                {language === 'ka' ? 'ქარ' : 'EN'}
            </Button>
        </Dropdown>
    );
};

const MainContentView = ({children, isDark, toggleTheme}) => {
    const screens = useBreakpoint()
    const {authData} = useContext(AuthContext);
    const {subNav} = useContext(SubNavContext);
    const [siderCollapsed, setSiderCollapsed] = useState(!subNav);
    const {t} = useLanguage();
    const {
        token: {colorBgContainer, borderRadiusLG, colorText, colorBgBase, colorBorderSecondary},
    } = theme.useToken();
    const isDarkMode = colorBgBase === "#000";
    const {logout} = useContext(AuthContext);

    // Sync collapsed state when subNav changes (e.g. navigating between pages)
    useEffect(() => {
        setSiderCollapsed(!subNav);
    }, [subNav]);
    const username = authData?.user?.username || '';
    const userIcon = (
        <Avatar
            style={{
                cursor: "pointer",
                backgroundColor: "#0765c2",
                boxShadow: '0 2px 8px rgba(7, 101, 194, 0.3)',
                transition: 'all 0.2s ease',
            }}
            size="large"
        >
            {username.charAt(0).toUpperCase()}
        </Avatar>
    );

    const items = [
        {
            key: '0',
            icon: (
                <Avatar style={{backgroundColor: "#0765c2"}} size="large">
                    {username.charAt(0).toUpperCase()}
                </Avatar>
            ),
            label: (
                <span style={{fontWeight: 500}}>{username}</span>
            ),
            disabled: true,
        },
        {type: 'divider'},
        {
            key: 'theme',
            icon: isDark ? <SunOutlined/> : <MoonOutlined/>,
            label: isDark ? (t.lightMode || 'Light mode') : (t.darkMode || 'Dark mode'),
            onClick: toggleTheme,
        },
        {type: 'divider'},
        {
            key: '1',
            icon: <LogoutOutlined/>,
            label: t.logout,
            danger: true,
            onClick: logout
        }
    ];

    return (
        <Layout style={{minHeight: "100vh", overflowX: "hidden"}}>
            {screens.lg && (
                <Sider
                    breakpoint="lg"
                    theme={isDarkMode ? "dark" : "light"}
                    collapsible={!!subNav}
                    collapsed={siderCollapsed}
                    onCollapse={(collapsed) => setSiderCollapsed(collapsed)}
                    style={{
                        borderRight: `1px solid ${colorBorderSecondary}`,
                        boxShadow: isDarkMode ? 'none' : '2px 0 8px rgba(0, 0, 0, 0.03)',
                    }}
                >
                    <Link to={window.location.href}>
                        <img
                            src={isDarkMode ? "logo-dark.png" : "logo-light.png"}
                            alt="Logo"
                            width="75%"
                            className="sidebar-logo"
                        />
                    </Link>
                    <Menu theme={isDarkMode ? "dark" : "light"}
                          mode="inline"
                          defaultSelectedKeys={authData?.role === "internal_admin" ? ['1'] : ['2']}
                          items={subNav}
                          style={{
                              borderRight: 'none',
                              fontWeight: 500,
                          }}
                    />
                </Sider>
            )}
            <Layout>
                <Header className="app-header" style={{
                    background: colorBgContainer,
                    borderBottom: `1px solid ${colorBorderSecondary}`,
                    height: 64,
                    lineHeight: '64px',
                }}>
                    {!screens.lg && (
                        <Flex align="center" style={{width: '100%', height: '100%', overflow: 'hidden'}}>
                            <Link to={window.location.href} style={{flexShrink: 0}}>
                                <img
                                    src={isDarkMode ? "logo-dark.png" : "logo-light.png"}
                                    alt="Logo"
                                    width="65px"
                                    style={{marginRight: 8}}
                                />
                            </Link>
                            {authData?.organization_name && (
                                <span className="org-name-badge" style={{
                                    color: colorText,
                                    maxWidth: 80,
                                    marginRight: 4,
                                    flexShrink: 0,
                                }}>
                                    {authData.organization_name}
                                </span>
                            )}
                            <Menu
                                style={{
                                    flex: 1,
                                    minWidth: 0,
                                    background: "transparent",
                                    borderBottom: 'none',
                                }}
                                theme={isDarkMode ? "dark" : "light"}
                                mode="horizontal"
                                defaultSelectedKeys={authData?.role === "internal_admin" ? ['1'] : ['2']}
                                items={subNav}
                            />
                            <Space size={4} style={{flexShrink: 0}}>
                                <LanguageSwitcher/>
                                <Dropdown menu={{items}} trigger={['click']}>
                                    {userIcon}
                                </Dropdown>
                            </Space>
                        </Flex>
                    )}
                    {screens.lg && (
                        <Flex justify="space-between" align="center" style={{height: '100%', width: '100%'}}>
                            <span className="org-name-badge" style={{color: colorText, fontSize: 16}}>
                                {authData?.organization_name || ''}
                            </span>
                            <Space size={12}>
                                <LanguageSwitcher/>
                                <Dropdown menu={{items}} trigger={['click']}>
                                    {userIcon}
                                </Dropdown>
                            </Space>
                        </Flex>
                    )}
                </Header>
                <Content style={{margin: '20px 16px 0'}}>
                    <div
                        className="main-content-card"
                        style={{
                            background: colorBgContainer,
                            borderRadius: 12,
                            border: `1px solid ${colorBorderSecondary}`,
                            boxShadow: isDarkMode ? 'none' : '0 1px 4px rgba(0, 0, 0, 0.04)',
                        }}
                    >
                        {children}
                    </div>
                </Content>
                <Footer style={{textAlign: 'center', padding: '16px 50px', opacity: 0.5, fontSize: 12}}>
                    <p style={{margin: 0}}>{t.footer}</p>
                </Footer>
            </Layout>

        </Layout>
    );
};


const AppContent = () => {
    const [isDark, setIsDark] = useState(localStorage.getItem("theme") === "dark");

    // Sync dark-theme class on body for CSS-based dark mode styling
    useEffect(() => {
        if (isDark) {
            document.body.classList.add("dark-theme");
        } else {
            document.body.classList.remove("dark-theme");
        }
    }, [isDark]);

    const toggleTheme = () => {
        document.body.classList.add("theme-transition");
        const newTheme = !isDark;
        setIsDark(!isDark);
        localStorage.setItem("theme", newTheme ? "dark" : "light");
        setTimeout(() => {
            document.body.classList.remove("theme-transition");
        }, 1000);
    };
    return (
        <ConfigProvider theme={{
            algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
            token: {
                borderRadius: 8,
                fontFamily: '"Noto Sans Georgian", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            },
            components: {
                Table: {
                    headerBorderRadius: 10,
                },
                Card: {
                    borderRadiusLG: 12,
                },
                Modal: {
                    borderRadiusLG: 16,
                },
            }
        }}>
            <AntdApp>
                <Routes>
                    {/* Public route */}
                    <Route path="/login" element={<Login/>}/>

                    {/* Private routes for different roles */}
                    <Route
                        path="/dashboard"
                        element={
                            <PrivateRoute allowedRoles={['company_admin', 'company_user']}>
                                <MainContentView isDark={isDark} toggleTheme={toggleTheme}>
                                    <Dashboard/>
                                </MainContentView>
                            </PrivateRoute>
                        }
                    />
                    <Route
                        path="/organizations"
                        element={
                            <PrivateRoute allowedRoles={['company_admin', 'internal_admin']}>
                                <MainContentView isDark={isDark} toggleTheme={toggleTheme}>
                                    <Organization/>
                                </MainContentView>
                            </PrivateRoute>
                        }
                    />
                    <Route
                        path="/warehouses"
                        element={
                            <PrivateRoute allowedRoles={['company_admin', 'internal_admin']}>
                                <MainContentView isDark={isDark} toggleTheme={toggleTheme}>
                                    <Warehouse/>
                                </MainContentView>
                            </PrivateRoute>
                        }
                    />
                    <Route
                        path="/system-admin-dashboard"
                        element={
                            <PrivateRoute allowedRoles={['company_admin', 'internal_admin']}>
                                <MainContentView isDark={isDark} toggleTheme={toggleTheme}>
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
        <LanguageProvider>
            <AuthProvider>
                <SubNavProvider>
                    <Router>
                        <AppContent/>
                    </Router>
                </SubNavProvider>
            </AuthProvider>
        </LanguageProvider>
    );
};

export default App;

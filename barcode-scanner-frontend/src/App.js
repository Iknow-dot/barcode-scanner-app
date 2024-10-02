import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './components/Auth/AuthContext';
import PrivateRoute from './components/PrivateRoute';
// import Header from './components/Common/Header';
import Footer from './components/Common/Footer';
import Dashboard from './components/Dashboard/Dashboard';
import Organization from './components/Organization/OrganizationList';
import Warehouse from './components/Warehouse/WarehouseList';
import Login from './components/Auth/Login';
import Logout from './components/Auth/Logout';
import SystemAdminDashboard from './components/SystemAdminDashboard/SystemAdminDashboard';

const AppContent = () => {
  // const location = useLocation(); // Get the current route

  // Render the header on all routes except login
  return (
    <>
      {/* {location.pathname !== '/login' && <Header />} */}
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<PrivateRoute allowedRoles={['admin', 'user']}><Dashboard /></PrivateRoute>} />
        <Route path="/organizations" element={<PrivateRoute allowedRoles={['admin', 'system_admin']}><Organization /></PrivateRoute>} />
        <Route path="/warehouses" element={<PrivateRoute allowedRoles={['admin', 'system_admin']}><Warehouse /></PrivateRoute>} />
        <Route path="/logout" element={<PrivateRoute allowedRoles={['admin', 'user', 'system_admin']}><Logout /></PrivateRoute>} />
        <Route path="/system-admin-dashboard" element={<PrivateRoute allowedRoles={['system_admin']}><SystemAdminDashboard /></PrivateRoute>} />
        <Route path="/" element={<Navigate to="/login" />} /> {/* Redirect to /login */}
      </Routes>
      <Footer />
    </>
  );
};

const App = () => {
  return (
    <AuthProvider>
      <Router>
        <AppContent />
      </Router>
    </AuthProvider>
  );
};

export default App;

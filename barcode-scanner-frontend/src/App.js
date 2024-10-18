import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './components/Auth/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import Footer from './components/Common/Footer';
import Dashboard from './components/UserDashboard/UserDashboard';
import Organization from './components/Organization/OrganizationList';
import Warehouse from './components/Warehouse/WarehouseList';
import Login from './components/Auth/Login';
import Logout from './components/Auth/Logout';
import SystemAdminDashboard from './components/SystemAdminDashboard/SystemAdminDashboard';

const AppContent = () => {
  return (
    <>
      <Routes>
        {/* Public route */}
        <Route path="/login" element={<Login />} />

        {/* Private routes for different roles */}
        <Route 
          path="/dashboard" 
          element={
            <PrivateRoute allowedRoles={['admin', 'user']}>
              <Dashboard />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/organizations" 
          element={
            <PrivateRoute allowedRoles={['admin', 'system_admin']}>
              <Organization />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/warehouses" 
          element={
            <PrivateRoute allowedRoles={['admin', 'system_admin']}>
              <Warehouse />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/system-admin-dashboard" 
          element={
            <PrivateRoute allowedRoles={['admin','system_admin']}>
              <SystemAdminDashboard />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/logout" 
          element={
            <PrivateRoute allowedRoles={['admin', 'user', 'system_admin']}>
              <Logout />
            </PrivateRoute>
          } 
        />

        {/* Redirect to login as the default route */}
        <Route path="/" element={<Navigate to="/login" />} />
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

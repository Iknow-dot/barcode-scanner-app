import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './components/Auth/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import Header from './components/Common/Header';
import Footer from './components/Common/Footer';
import Dashboard from './components/Dashboard/Dashboard';
import Organization from './components/Organization/OrganizationList';
import Warehouse from './components/Warehouse/WarehouseList';
import Login from './components/Auth/Login';
import Logout from './components/Auth/Logout';
import SystemAdminDashboard from './components/SystemAdminDashboard/SystemAdminDashboard';

const App = () => {
  return (
    <AuthProvider>
      <Router>
        <Header />
        <Routes>
          <Route path="/login" element={<Login />} />

          {/* Private Routes for authenticated users */}
          <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/organizations" element={<PrivateRoute><Organization /></PrivateRoute>} />
          <Route path="/warehouses" element={<PrivateRoute><Warehouse /></PrivateRoute>} />

          <Route path="/logout" element={<PrivateRoute><Logout /></PrivateRoute>} />
          
          {/* System Admin Dashboard route */}
          <Route path="/system-admin-dashboard" element={<PrivateRoute><SystemAdminDashboard /></PrivateRoute>} />

          <Route path="/" element={<Login />} />
        </Routes>
        <Footer />
      </Router>
    </AuthProvider>
  );
};

export default App;

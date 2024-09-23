import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import Organization from './components/Organization';
import Warehouse from './components/Warehouse';
import AuthPage from './components/AuthPage';

const App = () => {
  return (
    <AuthProvider>
      <Router>
        <Navbar />
        <Sidebar />
        <Routes>
          <Route path="/" element={<AuthPage />} />
          <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/organizations" element={<PrivateRoute><Organization /></PrivateRoute>} />
          <Route path="/warehouses" element={<PrivateRoute><Warehouse /></PrivateRoute>} />
        </Routes>
      </Router>
    </AuthProvider>
  );
};

export default App;

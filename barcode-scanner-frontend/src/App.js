import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './components/Auth/AuthContext'; // Path to AuthContext
import PrivateRoute from './components/PrivateRoute'; // Path to PrivateRoute
import Header from './components/Common/Header'; // Replacing Navbar with Header
import Footer from './components/Common/Footer'; // Replacing Sidebar with Footer
import Dashboard from './components/Dashboard/Dashboard'; // Adjust path to Dashboard component
import Organization from './components/Organization/OrganizationList'; // Adjust path to Organization component
import Warehouse from './components/Warehouse/WarehouseList'; // Adjust path to Warehouse component
import Login from './components/Auth/Login'; // Path to Login component
import Logout from './components/Auth/Logout'; // Path to Logout component

const App = () => {
  return (
    <AuthProvider>
      <Router>
        {/* <Header /> Replaced Navbar with Header */}
        <Routes>
          {/* Public Route for Login */}
          <Route path="/login" element={<Login />} />

          {/* Private Routes for authenticated users */}
          <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/organizations" element={<PrivateRoute><Organization /></PrivateRoute>} />
          <Route path="/warehouses" element={<PrivateRoute><Warehouse /></PrivateRoute>} />

          {/* Route for Logout */}
          <Route path="/logout" element={<PrivateRoute><Logout /></PrivateRoute>} />

          {/* Default route redirects to login */}
          <Route path="/" element={<Login />} />
        </Routes>
        <Footer /> {/* Replaced Sidebar with Footer */}
      </Router>
    </AuthProvider>
  );
};

export default App;

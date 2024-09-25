import React, { useContext } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import AuthContext from './Auth/AuthContext';

const PrivateRoute = ({ children }) => {
  const { authData } = useContext(AuthContext);
  const location = useLocation();

  if (!authData || !authData.token) {
    // Redirect to login if the user is not authenticated
    return <Navigate to="/login" />;
  }

  // Check if the user is a system admin and trying to access any route other than their dashboard
  if (authData.user && authData.user.role === 'system_admin' && location.pathname !== '/system-admin-dashboard') {
    return <Navigate to="/system-admin-dashboard" />;
  }

  // Otherwise, allow access to the requested route
  return children;
};

export default PrivateRoute;

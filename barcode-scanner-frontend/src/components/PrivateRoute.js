import React, { useContext } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import AuthContext from './Auth/AuthContext';

const PrivateRoute = ({ children, allowedRoles }) => {
  const { authData } = useContext(AuthContext);
  const location = useLocation();

  // If not authenticated, redirect to login
  if (!authData || !authData.token) {
    return <Navigate to="/login" state={{ from: location }} />;
  }

  // Retrieve the role from authData or localStorage
  const userRole = authData?.role || localStorage.getItem('role');

  // Check if user's role is allowed to access this route
  if (allowedRoles && !allowedRoles.includes(userRole)) {
    // Redirect based on the user's role
    if (userRole === 'system_admin') {
      return <Navigate to="/system-admin-dashboard" />;
    } else if (userRole === 'admin') {
      return <Navigate to="/dashboard" />;
    } else {
      return <Navigate to="/dashboard" />; // Default for other roles
    }
  }

  // Allow access to the requested route
  return children;
};

export default PrivateRoute;

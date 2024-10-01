import React, { useContext } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import AuthContext from './Auth/AuthContext';

const PrivateRoute = ({ children, allowedRoles }) => {
  const { authData } = useContext(AuthContext);
  const location = useLocation();

  if (!authData || !authData.token) {
    // Redirect to login if the user is not authenticated
    return <Navigate to="/login" state={{ from: location }} />;
  }

  const userRole = authData.user?.role;

  // Check if the user's role is allowed to access this route
  if (allowedRoles && !allowedRoles.includes(userRole)) {
    // Redirect users to their specific dashboards if they try to access an unauthorized route
    if (userRole === 'system_admin') {
      return <Navigate to="/system-admin-dashboard" />;
    } else if (userRole === 'admin') {
      return <Navigate to="/dashboard" />;
    } else {
      return <Navigate to="/dashboard" />; // Default dashboard for other roles
    }
  }

  // Otherwise, allow access to the requested route
  return children;
};

export default PrivateRoute;

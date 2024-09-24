import React, { useContext } from 'react';
import { Navigate } from 'react-router-dom';
import AuthContext from './Auth/AuthContext';

const PrivateRoute = ({ children }) => {
  const { authData } = useContext(AuthContext);

  return authData && authData.token ? children : <Navigate to="/" />;
};

export default PrivateRoute;

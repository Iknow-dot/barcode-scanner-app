import React, { createContext, useState } from 'react';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [authData, setAuthData] = useState(() => {
    const token = localStorage.getItem('token');
    const role = localStorage.getItem('role');
    const organization_id = localStorage.getItem('organization_id');
    const user = localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')) : null;
    return token && role ? { token, role, organization_id, user } : null;
  });

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('organization_id');
    localStorage.removeItem('user');
    setAuthData(null);
  };

  const login = (token, role, organization_id, user) => {
    localStorage.setItem('token', token);
    localStorage.setItem('role', role);
    localStorage.setItem('organization_id', organization_id);
    localStorage.setItem('user', JSON.stringify(user));
    setAuthData({ token, role, organization_id, user });
  };

  return (
    <AuthContext.Provider value={{ authData, setAuthData, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;

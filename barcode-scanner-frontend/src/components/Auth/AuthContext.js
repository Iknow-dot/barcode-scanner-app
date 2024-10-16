import React, { createContext, useState } from 'react';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [authData, setAuthData] = useState(() => {
    const token = localStorage.getItem('token');
    const role = localStorage.getItem('role');
    const organization_id = localStorage.getItem('organization_id'); // Fetch organization ID from localStorage
    return token && role ? { token, role, organization_id } : null;
  });

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('organization_id'); // Also remove the organization_id
    setAuthData(null);
  };

  const login = (token, role, organization_id) => {
    localStorage.setItem('token', token);
    localStorage.setItem('role', role);
    localStorage.setItem('organization_id', organization_id); // Store organization ID in localStorage
    setAuthData({ token, role, organization_id }); // Update state to include organization ID
  };

  return (
    <AuthContext.Provider value={{ authData, setAuthData, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;

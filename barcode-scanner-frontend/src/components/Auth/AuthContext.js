import React, { createContext, useState } from 'react';

// Create a new context for authentication
const AuthContext = createContext();

// AuthProvider component to provide authentication state to the entire app
export const AuthProvider = ({ children }) => {
  const [authData, setAuthData] = useState(() => {
    // Fetch token and role from localStorage when the app starts
    const token = localStorage.getItem('token');
    const role = localStorage.getItem('role');  // Fetch role from localStorage
    return token && role ? { token, role } : null;
  });

  // Function to handle user logout
  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');  // Ensure role is removed
    setAuthData(null);  // Clear authentication data
  };

  // Function to handle user login and token storage
  const login = (token, role) => {
    localStorage.setItem('token', token);
    localStorage.setItem('role', role);
    setAuthData({ token, role });  // Set the auth data in context
  };

  return (
    <AuthContext.Provider value={{ authData, setAuthData, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;

import React, { createContext, useState } from 'react';
import posthog from 'posthog-js';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [authData, setAuthData] = useState(() => {
    const token = localStorage.getItem('token');
    const role = localStorage.getItem('role');
    const organization_id = localStorage.getItem('organization_id');
    const organization_name = localStorage.getItem('organization_name');
    const user = localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')) : null;

    // Re-identify user in PostHog on page refresh if already logged in
    if (token && role && user) {
      posthog.identify(user?.username, {
        role: role,
        organization_id: organization_id,
        organization_name: organization_name,
        username: user?.username,
      });
    }

    return token && role ? { token, role, organization_id, user } : null;
  });

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('organization_id');
    localStorage.removeItem('organization_name');
    localStorage.removeItem('user');
    posthog.reset();
    setAuthData(null);
  };

  const login = (token, role, organization_id, organization_name, user) => {
    localStorage.setItem('token', token);
    localStorage.setItem('role', role);
    localStorage.setItem('organization_id', organization_id);
    localStorage.setItem('organization_name', organization_name);
    localStorage.setItem('user', JSON.stringify(user));
    console.log(organization_name);
    // Identify user in PostHog with role and organization
    posthog.identify(user?.username, {
      role: role,
      organization_id: organization_id,
      organization_name: organization_name,
      username: user?.username,
    });

    setAuthData({ token, role, organization_id, user });
  };

  return (
    <AuthContext.Provider value={{ authData, setAuthData, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;

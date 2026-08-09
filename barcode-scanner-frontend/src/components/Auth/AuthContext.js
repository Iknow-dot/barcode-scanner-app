import React, { createContext, useState } from 'react';
import posthog from 'posthog-js';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [authData, setAuthData] = useState(() => {
    const token = localStorage.getItem('token');
    const refreshToken = localStorage.getItem('refresh_token');
    const role = localStorage.getItem('role');
    const organization_id = localStorage.getItem('organization_id') || null;
    const organization_name = localStorage.getItem('organization_name');
    // localStorage stores null/undefined as the literal string "null"/"undefined"
    const sanitizedOrgName = (organization_name && organization_name !== 'null' && organization_name !== 'undefined')
        ? organization_name : null;
    const sanitizedOrgId = (organization_id && organization_id !== 'null' && organization_id !== 'undefined')
        ? organization_id : null;
    const warehouses = localStorage.getItem('warehouses') && JSON.parse(localStorage.getItem('warehouses'));
    const user = localStorage.getItem('user') && JSON.parse(localStorage.getItem('user'));
    const gift_marking_enabled = localStorage.getItem('gift_marking_enabled') === 'true';
    const product_catalog_enabled = localStorage.getItem('product_catalog_enabled') === 'true';

    // Re-identify user in PostHog on page refresh if already logged in
    if (token && role && user) {
      posthog.identify(user?.username, {
        role: role,
        organization_id: sanitizedOrgId,
        organization_name: sanitizedOrgName,
        warehouses: warehouses,
        username: user?.username,
      });
    }

    return token && role ? { token, refreshToken, role, organization_id: sanitizedOrgId, organization_name: sanitizedOrgName, warehouses, user, gift_marking_enabled, product_catalog_enabled } : null;
  });

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('role');
    localStorage.removeItem('organization_id');
    localStorage.removeItem('organization_name');
    localStorage.removeItem('warehouses');
    localStorage.removeItem('user');
    localStorage.removeItem('gift_marking_enabled');
    localStorage.removeItem('product_catalog_enabled');
    posthog.reset();
    setAuthData(null);
  };

  const login = (token, refreshToken, role, organization_id, organization_name, warehouses, user, gift_marking_enabled, product_catalog_enabled) => {
    const safeOrgId = organization_id || '';
    const safeOrgName = organization_name || '';
    const giftEnabled = gift_marking_enabled === true;
    const catalogEnabled = product_catalog_enabled === true;

    localStorage.setItem('token', token);
    localStorage.setItem('refresh_token', refreshToken);
    localStorage.setItem('role', role);
    localStorage.setItem('organization_id', safeOrgId);
    localStorage.setItem('organization_name', safeOrgName);
    localStorage.setItem('warehouses', JSON.stringify(warehouses));
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('gift_marking_enabled', String(giftEnabled));
    localStorage.setItem('product_catalog_enabled', String(catalogEnabled));
    // Identify user in PostHog with role and organization
    posthog.identify(user?.username, {
      role: role,
      organization_id: safeOrgId,
      organization_name: safeOrgName,
      username: user?.username,
      warehouse: warehouses,
    });

    setAuthData({ token, refreshToken, role, organization_id: safeOrgId || null, organization_name: safeOrgName || null, warehouses, user, gift_marking_enabled: giftEnabled, product_catalog_enabled: catalogEnabled });
  };

  return (
    <AuthContext.Provider value={{ authData, setAuthData, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;

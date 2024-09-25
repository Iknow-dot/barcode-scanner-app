import React, { useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AuthContext from './AuthContext';
import api from '../../api';  // Import the api.js instance to handle requests

const Logout = () => {
  const { setAuthData, logout } = useContext(AuthContext);  // Use the logout function from AuthContext
  const navigate = useNavigate();  // Replace useHistory with useNavigate

  useEffect(() => {
    const performLogout = async () => {
      try {
        // Make a logout request to the backend (optional, since JWT is stateless)
        await api.post('/auth/logout');
      } catch (error) {
        console.error('Error during logout:', error);
      } finally {
        // Clear authentication data and navigate to the login page
        logout();  // Use the logout function to clear local storage and auth context
        navigate('/login');  // Redirect to the login page
      }
    };

    performLogout();
  }, [logout, navigate]);

  return (
    <div className="logout-container">
      <p>Logging out...</p>
    </div>
  );
};

export default Logout;

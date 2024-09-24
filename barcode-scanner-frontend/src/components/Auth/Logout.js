import React, { useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';  // Replace useHistory with useNavigate
import AuthContext from './AuthContext';
import api from '../../api';  // Import the api.js instance to handle requests

const Logout = () => {
  const { setAuthData } = useContext(AuthContext);
  const navigate = useNavigate();  // Replace useHistory with useNavigate

  useEffect(() => {
    const logout = async () => {
      try {
        // Optionally make a logout request to the backend to invalidate the token
        await api.post('/auth/logout');
      } catch (error) {
        console.error('Error during logout:', error);
      } finally {
        // Clear authentication data from context and localStorage
        setAuthData(null);
        localStorage.removeItem('token');
        // Redirect to the login page
        navigate('/login');  // Replace history.push with navigate
      }
    };

    logout();
  }, [setAuthData, navigate]);

  return (
    <div className="logout-container">
      <p>Logging out...</p>
    </div>
  );
};

export default Logout;

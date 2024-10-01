import React, { useContext, useEffect } from 'react'; 
import { useNavigate } from 'react-router-dom';
import AuthContext from './AuthContext';
import api from '../../api';  // Import the api.js instance to handle requests

const Logout = () => {
  const { logout } = useContext(AuthContext);  // Use the logout function from AuthContext
  const navigate = useNavigate();  // Use navigate from react-router-dom

  useEffect(() => {
    const performLogout = async () => {
      try {
        // Optional: Make a logout request to the backend
        await api.post('/auth/logout');
      } catch (error) {
        console.error('Error during logout:', error);
      } finally {
        // Clear authentication data and navigate to the login page
        logout();  // Clear auth context and localStorage
        navigate('/login');  // Redirect to login page
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

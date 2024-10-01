import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom'; // Import useNavigate from react-router-dom
import api from '../../api';  // Assuming you're using api.js for API requests
import './Login.css'; 

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const navigate = useNavigate();  // Replace useHistory with useNavigate

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage('');  // Clear any previous errors

    try {
      const response = await api.post('/auth/login', {
        username,
        password
      });
      
      const token = response.data.access_token;  // Get JWT token from response
      const userRole = response.data.role.role_name;  // Assume the backend returns the user's role along with the token

      // Save the token to localStorage
      localStorage.setItem('token', token);

      // Handle role-based redirection
      if (userRole === 'system_admin') {
        navigate('/system-admin-dashboard');
      } else if (userRole === 'admin') {
        navigate('/dashboard');
      } else {
        navigate('/dashboard'); // Default for 'user' role or other roles
      }
    } catch (error) {
      if (error.response && error.response.status === 401) {
        setErrorMessage('Invalid username or password');
      } else {
        setErrorMessage('An error occurred. Please try again later.');
      }
    }
  };

  return (
    <div className="login-container">
      <img src="http://portal.iknow.ge/bitrix/templates/corp_services_blue/images/iknowlogo.png" alt="Logo" />
      <h1>Login</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          id="username"
          name="username"
          placeholder="Username"
          required
          value={username}
          onChange={e => setUsername(e.target.value)}
        />
        <input
          type="password"
          id="password"
          name="password"
          placeholder="Password"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
        <input type="submit" value="Login" />
        {errorMessage && <p className="error">{errorMessage}</p>}
      </form>
    </div>
  );
};

export default Login;

import React, { useState, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api';
import AuthContext from '../Auth/AuthContext';
import './Login.css';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, token, userRole } = useContext(AuthContext);
  const navigate = useNavigate();

  useEffect(() => {
    if (token) {
      navigate(userRole === 'system_admin' || userRole === 'admin' ? '/system-admin-dashboard' : '/dashboard');
    }
  }, [token, userRole, navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    if (!username || !password) {
      setErrorMessage('Please enter both username and password');
      return;
    }

    setLoading(true);
    try {
      const response = await api.post('/auth/login', { username, password });
      const { access_token, role, organization_id } = response.data;
      login(access_token, role, organization_id);
      navigate(role === 'system_admin' || role === 'admin' ? '/system-admin-dashboard' : '/dashboard');
    } catch (error) {
      setLoading(false);
      if (error.response) {
        setErrorMessage(error.response.status === 401 ? 'Invalid username or password' : 'An error occurred. Please try again later.');
      } else {
        setErrorMessage('Network error. Please try again later.');
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
          onChange={(e) => setUsername(e.target.value)}
          disabled={loading}
        />
        <input
          type="password"
          id="password"
          name="password"
          placeholder="Password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
        />
        <input type="submit" value={loading ? 'Logging in...' : 'Login'} disabled={loading} />
        {errorMessage && <p className="error">{errorMessage}</p>}
      </form>
    </div>
  );
};

export default Login;

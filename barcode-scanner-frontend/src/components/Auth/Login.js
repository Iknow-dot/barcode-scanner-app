import React, { useState, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { getClientIp } from '../../api';  // Make sure getClientIp is correctly imported
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
    // Redirect if already logged in
    if (token) {
      navigate(userRole === 'system_admin' || userRole === 'admin' ? '/system-admin-dashboard' : '/dashboard');
    }
  }, [token, userRole, navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    setLoading(true);
    if (!username || !password) {
      setErrorMessage('Please enter both username and password');
      setLoading(false);
      return;
    }

    try {
      const response = await api.post('/auth/login', { username, password });
      const { access_token, role, organization_id, userId } = response.data;
      // Set the token for subsequent requests before making additional API calls
      api.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;

      if (role === 'user') {
        const ipData = await getClientIp();
        if (ipData.success && ipData.ip.allowed) {
          login(access_token, role, organization_id);
          navigate('/dashboard');
        } else {
          setLoading(false);
          setErrorMessage('წვდომა შეზღუდულია.');
        }
      } else {
        login(access_token, role, organization_id);
        navigate(role === 'system_admin' || role === 'admin' ? '/system-admin-dashboard' : '/dashboard');
      }
    } catch (error) {
      setLoading(false);
      const errorMessage = error.response?.status === 401
        ? 'Invalid username or password'
        : 'An error occurred. Please try again later.';
      setErrorMessage(errorMessage);
    }
  };

  return (
    <div className="login-container">
      <img src="https://i.imgur.com/VV5PiDB.png" alt="Logo" />
      <h1>ავტორიზაცია</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          id="username"
          name="username"
          placeholder="მომხმარებლის სახელი"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={loading}
        />
        <input
          type="password"
          id="password"
          name="password"
          placeholder="პაროლი"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
        />
        <input type="submit" value={loading ? 'შესვლა...' : 'შესვლა'} disabled={loading} />
        {errorMessage && <p className="error">{errorMessage}</p>}
      </form>
    </div>
  );
};

export default Login;
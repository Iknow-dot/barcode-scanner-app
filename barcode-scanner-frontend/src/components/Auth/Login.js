import React, { useState } from 'react';
import axios from 'axios';
import './Login.css'; // Assuming you're using the CSS file as described before

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage('');  // Clear any previous errors

    try {
      const response = await axios.post('http://localhost:5000/auth/login', {
        username,
        password
      });
      
      const token = response.data.token;  // Assume backend returns a JWT token
      
      // Save token to localStorage (or use another method to store it securely)
      localStorage.setItem('token', token);
      
      // Redirect to the dashboard (adjust routing if needed)
      window.location.href = '/dashboard';
    } catch (error) {
      setErrorMessage('Invalid username or password');
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

import React, { useContext } from 'react';
import { Link, useLocation } from 'react-router-dom';
import AuthContext from '../Auth/AuthContext'; 

const Header = () => {
  const { authData, logout } = useContext(AuthContext);
  const location = useLocation();  // Get the current route

  // Hide header for login route
  if (location.pathname === '/login') {
    return null;  // Do not render header on the login page
  }

  return (
    <header className="app-header">
      <div className="container">
        <h1>Barcode Scanner App</h1>
        <nav>
          {authData ? (
            <ul>
              <li><Link to="/dashboard">Dashboard</Link></li>
              <li><button onClick={logout}>Logout</button></li>
            </ul>
          ) : (
            <ul>
              <li><Link to="/login">Login</Link></li>
            </ul>
          )}
        </nav>
      </div>
    </header>
  );
};

export default Header;

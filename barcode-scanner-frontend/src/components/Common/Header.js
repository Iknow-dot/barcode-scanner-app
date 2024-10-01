import React, { useContext } from 'react';
import { Link } from 'react-router-dom';
import AuthContext from '../Auth/AuthContext';  // Ensure the AuthContext is set up correctly

const Header = () => {
  const { authData, logout } = useContext(AuthContext);  // Add logout function
    
  return (
    <header className="app-header">
      <div className="container">
        <h1>Barcode Scanner App</h1>
        <nav>
          {authData ? (
            <ul>
              <li><Link to="/dashboard">Dashboard</Link></li>
              <li><button onClick={logout}>Logout</button></li>  {/* Updated Logout */}
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

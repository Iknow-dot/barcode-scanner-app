import React, { useContext, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import AuthContext from '../context/AuthContext'; // Context to manage auth state

const Logout = () => {
  const { setAuthData } = useContext(AuthContext);
  const history = useHistory();

  useEffect(() => {
    const logout = () => {
      setAuthData(null); // Clear authentication context
      history.push('/login'); // Redirect to login page
    };
    logout();
  }, [setAuthData, history]);

  return (
    <div className="logout-container">
      <p>Logging out...</p>
    </div>
  );
};

export default Logout;

import React, {useContext, useEffect} from 'react';
import {useNavigate} from 'react-router-dom';
import AuthContext from './AuthContext';
import {authService} from '../../api';

const Logout = () => {
    const {logout} = useContext(AuthContext);
    const navigate = useNavigate();

    useEffect(() => {
        const performLogout = async () => {
            const refreshToken = localStorage.getItem('refresh_token');
            if (refreshToken) {
                await authService.logout(refreshToken);
            }
            logout();
            navigate('/login');
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

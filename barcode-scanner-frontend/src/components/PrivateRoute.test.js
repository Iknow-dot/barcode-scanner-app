import {render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import PrivateRoute from './PrivateRoute';
import AuthContext from './Auth/AuthContext';

const SECRET = 'protected page';
const LOGIN = 'login page';
const USER_HOME = 'user dashboard';
const ADMIN_HOME = 'admin dashboard';

const renderGuarded = (authData, allowedRoles) => render(
    <AuthContext.Provider value={{authData}}>
        <MemoryRouter initialEntries={['/secret']}>
            <Routes>
                <Route
                    path="/secret"
                    element={(
                        <PrivateRoute allowedRoles={allowedRoles}>
                            <div>{SECRET}</div>
                        </PrivateRoute>
                    )}
                />
                <Route path="/login" element={<div>{LOGIN}</div>}/>
                <Route path="/dashboard" element={<div>{USER_HOME}</div>}/>
                <Route path="/system-admin-dashboard" element={<div>{ADMIN_HOME}</div>}/>
            </Routes>
        </MemoryRouter>
    </AuthContext.Provider>,
);

describe('PrivateRoute', () => {
    afterEach(() => localStorage.clear());

    it('sends an unauthenticated visitor to login', () => {
        renderGuarded(null, ['company_user']);
        expect(screen.getByText(LOGIN)).toBeInTheDocument();
        expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
    });

    it('treats a missing token as unauthenticated even with a role', () => {
        renderGuarded({role: 'company_user'}, ['company_user']);
        expect(screen.getByText(LOGIN)).toBeInTheDocument();
    });

    it('renders the page when the role is allowed', () => {
        renderGuarded({token: 't', role: 'company_user'}, ['company_user']);
        expect(screen.getByText(SECRET)).toBeInTheDocument();
    });

    it('sends a company_user away from an admin-only page', () => {
        renderGuarded({token: 't', role: 'company_user'}, ['company_admin']);
        expect(screen.getByText(USER_HOME)).toBeInTheDocument();
        expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
    });

    it('sends a company_admin away from a user-only page', () => {
        renderGuarded({token: 't', role: 'company_admin'}, ['company_user']);
        expect(screen.getByText(ADMIN_HOME)).toBeInTheDocument();
    });

    it('sends an internal_admin to the admin dashboard', () => {
        renderGuarded({token: 't', role: 'internal_admin'}, ['company_user']);
        expect(screen.getByText(ADMIN_HOME)).toBeInTheDocument();
    });

    it('sends an unrecognised role to login rather than guessing a home', () => {
        renderGuarded({token: 't', role: 'something_else'}, ['company_user']);
        expect(screen.getByText(LOGIN)).toBeInTheDocument();
    });

    it('falls back to the stored role when authData carries none', () => {
        localStorage.setItem('role', 'company_user');
        renderGuarded({token: 't'}, ['company_user']);
        expect(screen.getByText(SECRET)).toBeInTheDocument();
    });

    it('allows any role when the route declares no restriction', () => {
        renderGuarded({token: 't', role: 'company_user'}, undefined);
        expect(screen.getByText(SECRET)).toBeInTheDocument();
    });
});

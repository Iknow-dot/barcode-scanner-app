import React, {useContext} from 'react';
import {render, screen, act} from '@testing-library/react';
import AuthContext, {AuthProvider} from './AuthContext';

jest.mock('posthog-js', () => ({
  identify: jest.fn(),
  reset: jest.fn(),
}));

const Probe = () => {
  const {authData, login, logout} = useContext(AuthContext);
  return (
    <div>
      <span data-testid="gift">{String(authData?.gift_marking_enabled)}</span>
      <button onClick={() => login(
        'tok', 'ref', 'company_user', 1, 'Org', [], {username: 'u'}, true,
      )}>login</button>
      <button onClick={logout}>logout</button>
    </div>
  );
};

describe('AuthContext gift_marking_enabled', () => {
  beforeEach(() => localStorage.clear());

  it('carries the flag through login()', () => {
    render(<AuthProvider><Probe/></AuthProvider>);
    act(() => screen.getByText('login').click());
    expect(screen.getByTestId('gift')).toHaveTextContent('true');
    expect(localStorage.getItem('gift_marking_enabled')).toBe('true');
  });

  it('hydrates the flag from localStorage on refresh', () => {
    localStorage.setItem('token', 'tok');
    localStorage.setItem('role', 'company_user');
    localStorage.setItem('user', JSON.stringify({username: 'u'}));
    localStorage.setItem('gift_marking_enabled', 'true');
    render(<AuthProvider><Probe/></AuthProvider>);
    expect(screen.getByTestId('gift')).toHaveTextContent('true');
  });

  it('clears the flag on logout', () => {
    render(<AuthProvider><Probe/></AuthProvider>);
    act(() => screen.getByText('login').click());
    act(() => screen.getByText('logout').click());
    expect(localStorage.getItem('gift_marking_enabled')).toBeNull();
  });
});

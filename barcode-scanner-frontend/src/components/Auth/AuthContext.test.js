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
      <span data-testid="catalog">{String(authData?.product_catalog_enabled)}</span>
      <button onClick={() => login(
        'tok', 'ref', 'company_user', 1, 'Org', [], {username: 'u'}, true, true,
      )}>login</button>
      <button onClick={logout}>logout</button>
    </div>
  );
};

describe('AuthContext feature flags', () => {
  beforeEach(() => localStorage.clear());

  it('carries the flags through login()', () => {
    render(<AuthProvider><Probe/></AuthProvider>);
    act(() => screen.getByText('login').click());
    expect(screen.getByTestId('gift')).toHaveTextContent('true');
    expect(screen.getByTestId('catalog')).toHaveTextContent('true');
    expect(localStorage.getItem('gift_marking_enabled')).toBe('true');
    expect(localStorage.getItem('product_catalog_enabled')).toBe('true');
  });

  it('hydrates the flags from localStorage on refresh', () => {
    localStorage.setItem('token', 'tok');
    localStorage.setItem('role', 'company_user');
    localStorage.setItem('user', JSON.stringify({username: 'u'}));
    localStorage.setItem('gift_marking_enabled', 'true');
    localStorage.setItem('product_catalog_enabled', 'true');
    render(<AuthProvider><Probe/></AuthProvider>);
    expect(screen.getByTestId('gift')).toHaveTextContent('true');
    expect(screen.getByTestId('catalog')).toHaveTextContent('true');
  });

  it('clears the flags on logout', () => {
    render(<AuthProvider><Probe/></AuthProvider>);
    act(() => screen.getByText('login').click());
    act(() => screen.getByText('logout').click());
    expect(localStorage.getItem('gift_marking_enabled')).toBeNull();
    expect(localStorage.getItem('product_catalog_enabled')).toBeNull();
  });
});

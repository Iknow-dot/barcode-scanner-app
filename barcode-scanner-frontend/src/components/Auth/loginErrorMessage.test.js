import loginErrorMessage from './loginErrorMessage';

const t = {
    ipNotAllowed: 'ip blocked',
    deviceNotAllowed: 'device blocked',
    invalidCredentials: 'bad credentials',
    loginThrottled: (minutes) => `wait ${minutes} min`,
};

describe('loginErrorMessage', () => {
    it('translates a lockout with the wait rounded up to whole minutes', () => {
        const result = {code: 'LOGIN_THROTTLED', data: {retry_after: 61}};
        expect(loginErrorMessage(result, t)).toBe('wait 2 min');
    });

    it('never tells a locked-out user to wait zero minutes', () => {
        expect(loginErrorMessage({code: 'LOGIN_THROTTLED', data: {retry_after: 5}}, t))
            .toBe('wait 1 min');
        expect(loginErrorMessage({code: 'LOGIN_THROTTLED'}, t)).toBe('wait 1 min');
    });

    it('translates the IP and device refusals by code', () => {
        expect(loginErrorMessage({code: 'IP_NOT_ALLOWED'}, t)).toBe('ip blocked');
        expect(loginErrorMessage({code: 'DEVICE_NOT_ALLOWED'}, t)).toBe('device blocked');
    });

    it('falls back to the error text, then to invalid credentials', () => {
        expect(loginErrorMessage({code: null, error: 'Network Error'}, t)).toBe('Network Error');
        expect(loginErrorMessage({code: null}, t)).toBe('bad credentials');
    });
});

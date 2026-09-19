import weakPasswordMessage from './weakPasswordMessage';

const t = {
    passwordMinLength: 'too short',
    passwordTooCommon: 'too common',
    passwordEntirelyNumeric: 'only digits',
    passwordTooSimilar: 'like the username',
};

const weak = (reasons, detail = 'Backend text.') => ({
    success: false,
    data: {password: {code: 'WEAK_PASSWORD', detail, reasons}},
});

describe('weakPasswordMessage', () => {
    it('translates every reason the backend gives', () => {
        expect(weakPasswordMessage(weak(['password_too_common', 'password_entirely_numeric']), t))
            .toBe('too common only digits');
    });

    it('covers each of Django\'s default validators', () => {
        expect(weakPasswordMessage(weak(['password_too_short']), t)).toBe('too short');
        expect(weakPasswordMessage(weak(['password_too_similar']), t)).toBe('like the username');
    });

    it('falls back to the backend text for a reason it cannot translate', () => {
        expect(weakPasswordMessage(weak(['password_from_a_new_validator']), t)).toBe('Backend text.');
    });

    it('returns null for any other failure', () => {
        expect(weakPasswordMessage({success: false, code: 'USER_LIMIT_REACHED', data: {}}, t)).toBeNull();
        expect(weakPasswordMessage({success: false, data: {username: ['taken']}}, t)).toBeNull();
        expect(weakPasswordMessage({success: false}, t)).toBeNull();
    });
});

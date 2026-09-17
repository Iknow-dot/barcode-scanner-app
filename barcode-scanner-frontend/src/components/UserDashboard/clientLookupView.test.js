import {
    LOOKUP_TABS,
    AUTO_LOOKUP_DEBOUNCE_MS,
    AUTO_LOOKUP_MIN_ID_DIGITS,
    NAME_MIN_CHARS,
    tabConfig,
    normalizePhone,
    isSearchable,
    lookupArgs,
    clientRow,
    countLabel,
    createSeed,
} from './clientLookupView';

describe('constants', () => {
    it('exposes the tab order and thresholds', () => {
        expect(LOOKUP_TABS).toEqual(['id', 'phone', 'name']);
        expect(AUTO_LOOKUP_DEBOUNCE_MS).toBe(1500);
        expect(AUTO_LOOKUP_MIN_ID_DIGITS).toBe(9);
        expect(NAME_MIN_CHARS).toBe(3);
    });
});

describe('tabConfig', () => {
    it('describes each tab for the segmented control and its field', () => {
        expect(tabConfig('id').inputMode).toBe('numeric');
        expect(tabConfig('name').trigger).toBe('submit');
        expect(tabConfig('phone').trigger).toBe('auto');
    });

    it('carries a labelKey and placeholderKey for every tab', () => {
        LOOKUP_TABS.forEach((tab) => {
            const config = tabConfig(tab);
            expect(typeof config.labelKey).toBe('string');
            expect(typeof config.placeholderKey).toBe('string');
        });
    });
});

describe('normalizePhone', () => {
    it('strips +995 / 995 / leading 0', () => {
        expect(normalizePhone('+995599451230')).toBe('599451230');
        expect(normalizePhone('995599451230')).toBe('599451230');
        expect(normalizePhone('0599451230')).toBe('599451230');
        expect(normalizePhone('599451230')).toBe('599451230');
    });
});

describe('isSearchable', () => {
    it('needs nine digits on the id tab', () => {
        expect(isSearchable('id', '12345678')).toBe(false);
        expect(isSearchable('id', '123456789')).toBe(true);
        expect(isSearchable('id', '12345678x')).toBe(false); // digits only
    });
    it('accepts a mobile number in every written form', () => {
        ['599451230', '0599451230', '+995599451230', '995599451230']
            .forEach((v) => expect(isSearchable('phone', v)).toBe(true));
        expect(isSearchable('phone', '59945123')).toBe(false);
        expect(isSearchable('phone', '499451230')).toBe(false); // must start with 5
    });
    it('needs three characters on the name tab', () => {
        expect(isSearchable('name', 'ბე')).toBe(false);
        expect(isSearchable('name', 'ბერ')).toBe(true);
    });
});

describe('lookupArgs', () => {
    it('sends exactly one criterion', () => {
        expect(lookupArgs('id', ' 123456789 ')).toEqual({identification_number: '123456789'});
        expect(lookupArgs('phone', '0599451230')).toEqual({phone: '599451230'});
        expect(lookupArgs('name', ' ბერიძე ')).toEqual({name: 'ბერიძე'});
    });
});

describe('createSeed', () => {
    it('splits a typed name on the first space only', () => {
        expect(createSeed('name', 'გიორგი ბერიძე ჯგუფი'))
            .toMatchObject({first_name: 'გიორგი', last_name: 'ბერიძე ჯგუფი'});
        expect(createSeed('name', 'ბერიძე')).toMatchObject({first_name: 'ბერიძე', last_name: ''});
    });
    it('seeds the identifier fields from the other tabs', () => {
        expect(createSeed('id', '123456789')).toMatchObject({identification_number: '123456789'});
        expect(createSeed('phone', '0599451230')).toMatchObject({phone: '599451230'});
    });
});

describe('clientRow', () => {
    it('joins the identifier and phone with a middot and tolerates gaps', () => {
        expect(clientRow({name: 'ანა', identification_number: '01', phone: '599'}).meta)
            .toBe('01 · 599');
        expect(clientRow({name: 'ანა', phone: '599'}).meta).toBe('599');
        expect(clientRow({name: 'ანა'}).meta).toBe('');
    });
});

describe('countLabel', () => {
    it('reads "3 კლიენტი"', () => {
        const t = {clientsFoundCount: 'კლიენტი'};
        expect(countLabel(3, t)).toBe('3 კლიენტი');
    });
});

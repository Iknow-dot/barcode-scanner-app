import formatConversionRate from './formatConversionRate';

describe('formatConversionRate', () => {
    it('formats a 0..1 rate as a whole percent', () => {
        expect(formatConversionRate(0.583)).toBe('58%');
        expect(formatConversionRate(0)).toBe('0%');
        expect(formatConversionRate(1)).toBe('100%');
    });

    it('handles missing/invalid input as 0%', () => {
        expect(formatConversionRate(null)).toBe('0%');
        expect(formatConversionRate(undefined)).toBe('0%');
    });
});

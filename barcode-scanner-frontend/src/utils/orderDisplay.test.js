import displayCustomerName from './orderDisplay';

const t = {retailCustomerLabel: 'Retail customer'};

describe('displayCustomerName', () => {
    it('returns the retail label for a retail order', () => {
        expect(displayCustomerName({is_retail: true, customer_name: ''}, t)).toBe('Retail customer');
    });

    it('returns the retail label even if a stray customer_name is present', () => {
        expect(displayCustomerName({is_retail: true, customer_name: 'X'}, t)).toBe('Retail customer');
    });

    it('returns the customer_name for a normal order', () => {
        expect(displayCustomerName({is_retail: false, customer_name: 'Nino'}, t)).toBe('Nino');
    });

    it('returns empty string when not retail and no name', () => {
        expect(displayCustomerName({is_retail: false, customer_name: ''}, t)).toBe('');
        expect(displayCustomerName(null, t)).toBe('');
    });
});

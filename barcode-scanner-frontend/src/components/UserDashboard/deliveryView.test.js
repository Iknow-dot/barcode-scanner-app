import {dateValue, isDeliveryOrder, recipientPatch, recipientPhoneValid, timeValue} from './deliveryView';

describe('deliveryView', () => {
    it('treats only delivery_type "delivery" as a delivery', () => {
        expect(isDeliveryOrder({delivery_type: 'delivery'})).toBe(true);
        expect(isDeliveryOrder({delivery_type: 'pickup'})).toBe(false);
        expect(isDeliveryOrder({})).toBe(false);
    });

    it('accepts an empty phone, nine digits, or +995 and nine digits', () => {
        expect(recipientPhoneValid('')).toBe(true);
        expect(recipientPhoneValid('555 12 34 56')).toBe(true);
        expect(recipientPhoneValid('+995555123456')).toBe(true);
        expect(recipientPhoneValid('55512345')).toBe(false);
        expect(recipientPhoneValid('+1 555123456')).toBe(false);
    });

    it('clears the other recipient when switching back to the same one', () => {
        expect(recipientPatch('different')).toEqual({recipient_is_different: true});
        expect(recipientPatch('same')).toEqual({
            recipient_is_different: false,
            recipient_first_name: '',
            recipient_last_name: '',
            recipient_phone: '',
        });
    });

    it('reads stored times and dates for the pickers', () => {
        expect(timeValue('12:30:00').format('HH:mm')).toBe('12:30');
        expect(timeValue('09:05').format('HH:mm')).toBe('09:05');
        expect(timeValue(null)).toBeNull();
        expect(dateValue('2026-09-16').format('YYYY-MM-DD')).toBe('2026-09-16');
        expect(dateValue('')).toBeNull();
    });
});

import formatConfirmError from './confirmError';
import translations from '../../i18n/translations';

describe('formatConfirmError', () => {
    it('shows the upstream 1C reason beneath the ORDER_CREATE_REJECTED headline', () => {
        const result = {
            code: 'ORDER_CREATE_REJECTED',
            data: {code: 'ORDER_CREATE_REJECTED', detail: 'Customer not found by ClientIDPhone: 599000000'},
        };

        const mapped = formatConfirmError(result, translations.en);

        expect(mapped.title).toBe(translations.en.orderCreateRejectedTitle);
        const lines = mapped.message.split('\n');
        expect(lines[0]).toBe(translations.en.orderCreateRejected);
        expect(lines[1]).toContain('Customer not found by ClientIDPhone');
    });

    it('omits the second line when ORDER_CREATE_REJECTED carries no detail', () => {
        const mapped = formatConfirmError(
            {code: 'ORDER_CREATE_REJECTED', data: {}},
            translations.ka,
        );

        expect(mapped.message).toBe(translations.ka.orderCreateRejected);
        expect(mapped.message).not.toContain('\n');
    });

    it('maps the warehouse and empty-order guards to localized messages', () => {
        const cases = [
            ['MULTIPLE_WAREHOUSES', 'multipleWarehousesError'],
            ['MISSING_WAREHOUSE', 'missingWarehouseError'],
            ['EMPTY_ORDER', 'emptyOrderError'],
        ];
        for (const [code, key] of cases) {
            for (const lang of ['ka', 'en']) {
                const mapped = formatConfirmError({code, data: {}}, translations[lang]);
                expect(mapped.title).toBe(translations[lang].orderError);
                expect(mapped.message).toBe(translations[lang][key]);
            }
        }
    });

    it('maps MISSING_CLIENT to a localized message', () => {
        for (const lang of ['ka', 'en']) {
            const mapped = formatConfirmError({code: 'MISSING_CLIENT', data: {}}, translations[lang]);
            expect(mapped.title).toBe(translations[lang].orderError);
            expect(mapped.message).toBe(translations[lang].missingClientError);
        }
    });

    it('names the product in ITEM_LOOKUP_KEY_MISSING when the backend sent a sku', () => {
        const mapped = formatConfirmError(
            {code: 'ITEM_LOOKUP_KEY_MISSING', data: {sku: 'SKU-42'}},
            translations.en,
        );

        expect(mapped.message).toContain('SKU-42');
    });

    it('falls back to the generic item message when the sku is blank', () => {
        const mapped = formatConfirmError(
            {code: 'ITEM_LOOKUP_KEY_MISSING', data: {sku: ''}},
            translations.en,
        );

        expect(mapped.message).toBe(translations.en.itemLookupKeyMissingGeneric);
    });

    it('returns null for unknown codes so callers fall back to the raw error', () => {
        expect(formatConfirmError({code: 'SOMETHING_ELSE', data: {}}, translations.en)).toBeNull();
        expect(formatConfirmError({code: null, data: undefined}, translations.en)).toBeNull();
    });
});

import formatInsufficientStock from './insufficientStock';
import translations from '../../i18n/translations';

describe('formatInsufficientStock', () => {
    it('formats one line per short item with name, warehouse and quantities', () => {
        const items = [
            {
                sku: 'S1', sku_name: 'Candle', warehouse_code: 'W1',
                warehouse_name: 'Main', requested: '5', available: '3',
            },
            {
                sku: 'S2', sku_name: 'Vase', warehouse_code: 'W2',
                warehouse_name: 'Depot', requested: '2', available: '0',
            },
        ];

        const message = formatInsufficientStock(items, translations.en);

        const lines = message.split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain('Candle');
        expect(lines[0]).toContain('Main');
        expect(lines[0]).toContain('5');
        expect(lines[0]).toContain('3');
        expect(lines[1]).toContain('Vase');
    });

    it('falls back to sku and warehouse code when names are blank', () => {
        const items = [{
            sku: 'S1', sku_name: '', warehouse_code: 'W1',
            warehouse_name: '', requested: '5', available: '3',
        }];

        const message = formatInsufficientStock(items, translations.en);

        expect(message).toContain('S1');
        expect(message).toContain('W1');
    });

    it('returns the generic message when the backend sent no item detail', () => {
        expect(formatInsufficientStock(undefined, translations.ka))
            .toBe(translations.ka.insufficientStockGeneric);
        expect(formatInsufficientStock([], translations.en))
            .toBe(translations.en.insufficientStockGeneric);
    });
});

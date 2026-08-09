import {catalogFeatureEnabled} from './features';

describe('catalogFeatureEnabled', () => {
    it('is true only when the login payload carries the org flag', () => {
        expect(catalogFeatureEnabled({product_catalog_enabled: true})).toBe(true);
    });

    it('is false when the flag is off, missing, or there is no auth data', () => {
        expect(catalogFeatureEnabled({product_catalog_enabled: false})).toBe(false);
        expect(catalogFeatureEnabled({})).toBe(false);
        expect(catalogFeatureEnabled(null)).toBe(false);
        expect(catalogFeatureEnabled(undefined)).toBe(false);
    });
});

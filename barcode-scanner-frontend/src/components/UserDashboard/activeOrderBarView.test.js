import activeOrderBarView from './activeOrderBarView';

const t = {
    cart: 'Cart',
    cartEmpty: 'Empty',
    activeOrder: 'Active Order',
    retailCustomerLabel: 'Retail customer',
};

describe('activeOrderBarView', () => {
    it('is idle with no badge when there is no active order', () => {
        const idle = {active: false, badgeCount: 0, title: 'Cart', subtitle: 'Empty'};
        expect(activeOrderBarView(null, t)).toEqual(idle);
        expect(activeOrderBarView(undefined, t)).toEqual(idle);
    });

    it('shows the client, item count and total of an active order', () => {
        const order = {
            id: 142,
            customer_name: 'Giorgi Beridze',
            items: [{id: 1}, {id: 2}, {id: 3}, {id: 4}],
            total: '488.30',
        };
        expect(activeOrderBarView(order, t)).toEqual({
            active: true,
            badgeCount: 4,
            title: 'Giorgi Beridze',
            subtitle: 'Active Order · 488.30 ₾',
        });
    });

    it('labels a retail order with the retail customer label', () => {
        const order = {id: 9, is_retail: true, customer_name: '', items: [], total: '0.00'};
        expect(activeOrderBarView(order, t)).toMatchObject({
            active: true,
            badgeCount: 0,
            title: 'Retail customer',
            subtitle: 'Active Order · 0.00 ₾',
        });
    });

    it('falls back to the order number when the order has no client name', () => {
        const order = {id: 7, customer_name: ''};
        expect(activeOrderBarView(order, t)).toEqual({
            active: true,
            badgeCount: 0,
            title: '#7',
            subtitle: 'Active Order',
        });
    });
});

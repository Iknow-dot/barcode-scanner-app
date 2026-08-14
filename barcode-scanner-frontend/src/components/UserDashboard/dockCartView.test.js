import dockCartView from './dockCartView';

describe('dockCartView', () => {
    it('returns the empty state when there is no active order', () => {
        expect(dockCartView(null)).toEqual({
            badgeCount: 0,
            totalLabel: null,
            opensDrawer: false,
        });
        expect(dockCartView(undefined)).toEqual({
            badgeCount: 0,
            totalLabel: null,
            opensDrawer: false,
        });
    });

    it('derives badge count and formatted total from an active order', () => {
        const order = {
            id: 142,
            items: [{id: 1}, {id: 2}, {id: 3}],
            total: '145.50',
        };
        expect(dockCartView(order)).toEqual({
            badgeCount: 3,
            totalLabel: '145.50₾',
            opensDrawer: true,
        });
    });

    it('handles an order with no items array yet', () => {
        const order = {id: 7, total: '0.00'};
        expect(dockCartView(order)).toEqual({
            badgeCount: 0,
            totalLabel: '0.00₾',
            opensDrawer: true,
        });
    });

    it('returns a null total label when the order has no total', () => {
        const order = {id: 8, items: [{id: 1}]};
        expect(dockCartView(order)).toEqual({
            badgeCount: 1,
            totalLabel: null,
            opensDrawer: true,
        });
    });
});

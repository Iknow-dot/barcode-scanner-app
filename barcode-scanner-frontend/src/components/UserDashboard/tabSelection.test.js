import {nextTabAction} from './tabSelection';

describe('nextTabAction', () => {
    it('switches when tapping a different tab (Orders -> Products, keeps the result)', () => {
        expect(nextTabAction('orders', 'scan', true)).toBe('switch');
        expect(nextTabAction('orders', 'scan', false)).toBe('switch');
    });

    it('switches when tapping a different tab (Products -> Orders)', () => {
        expect(nextTabAction('scan', 'orders', true)).toBe('switch');
        expect(nextTabAction('scan', 'orders', false)).toBe('switch');
    });

    it('pops to Home when re-tapping Products while a product result is showing', () => {
        expect(nextTabAction('scan', 'scan', true)).toBe('pop-to-home');
    });

    it('does nothing when re-tapping Products with no product result showing', () => {
        expect(nextTabAction('scan', 'scan', false)).toBe('none');
    });

    it('does nothing when re-tapping the already-selected Orders tab', () => {
        expect(nextTabAction('orders', 'orders', true)).toBe('none');
        expect(nextTabAction('orders', 'orders', false)).toBe('none');
    });
});

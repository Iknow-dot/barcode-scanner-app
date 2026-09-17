import {ORDER_STATUS_COLOR, orderStatusColor} from './orderStatusColor';

test('maps each order status to its tag colour', () => {
    expect(orderStatusColor('draft')).toBe('default');
    expect(orderStatusColor('confirmed')).toBe('blue');
    expect(orderStatusColor('completed')).toBe('cyan');
    expect(orderStatusColor('cancelled')).toBe('red');
});

test('falls back to default for an unknown status', () => {
    expect(orderStatusColor('archived')).toBe('default');
    expect(orderStatusColor(undefined)).toBe('default');
});

test('never uses green, which is the accent', () => {
    expect(Object.values(ORDER_STATUS_COLOR)).not.toContain('green');
});

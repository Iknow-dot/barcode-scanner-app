import {act, renderHook} from '@testing-library/react';
import useAutoDiscount from './useAutoDiscount';
import {orderService} from '../../api';

jest.mock('../../api', () => ({orderService: {autoDiscount: jest.fn()}}));

const order = (items, extra = {}) => ({id: 5, status: 'draft', items, ...extra});
const line = (extra = {}) => ({id: 1, sku: 'S', quantity: 1, price: '10.00', ...extra});
const answer = (data) => ({success: true, data});

beforeEach(() => {
    jest.useFakeTimers();
    orderService.autoDiscount.mockReset();
});
afterEach(() => jest.useRealTimers());

const flush = async () => {
    await act(async () => { jest.advanceTimersByTime(800); });
    await act(async () => {});
};

it('asks once after the debounce and hands back the order', async () => {
    const onOrder = jest.fn();
    const fresh = order([line({auto_discount_percent: '10.00'})]);
    orderService.autoDiscount.mockResolvedValue(answer(fresh));
    renderHook(() => useAutoDiscount({order: order([line()]), active: true, enabled: true, onOrder}));
    await flush();
    expect(orderService.autoDiscount).toHaveBeenCalledWith(5);
    expect(onOrder).toHaveBeenCalledWith(fresh);
});

it('does not re-ask when only the auto percent changed', async () => {
    const onOrder = jest.fn();
    orderService.autoDiscount.mockResolvedValue(answer(order([line({auto_discount_percent: '10.00'})])));
    const {rerender} = renderHook((props) => useAutoDiscount(props),
        {initialProps: {order: order([line()]), active: true, enabled: true, onOrder}});
    await flush();
    rerender({order: order([line({auto_discount_percent: '10.00'})]), active: true, enabled: true, onOrder});
    await flush();
    expect(orderService.autoDiscount).toHaveBeenCalledTimes(1);
});

it('drops an answer that a newer cart edit overtook', async () => {
    const onOrder = jest.fn();
    let resolveFirst;
    orderService.autoDiscount
        .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
        .mockResolvedValueOnce(answer(order([line({quantity: 2, auto_discount_percent: '10.00'})])));
    const {rerender} = renderHook((props) => useAutoDiscount(props),
        {initialProps: {order: order([line()]), active: true, enabled: true, onOrder}});
    await flush();
    rerender({order: order([line({quantity: 2})]), active: true, enabled: true, onOrder});
    await act(async () => resolveFirst(answer(order([line({auto_discount_percent: '5.00'})]))));
    await flush();
    expect(onOrder).toHaveBeenCalledTimes(1);
    expect(onOrder.mock.calls[0][0].items[0].quantity).toBe(2);
});

it('ignores a stale answer from the service', async () => {
    const onOrder = jest.fn();
    orderService.autoDiscount.mockResolvedValue({success: true, data: order([line()]), stale: true});
    renderHook(() => useAutoDiscount({order: order([line()]), active: true, enabled: true, onOrder}));
    await flush();
    expect(onOrder).not.toHaveBeenCalled();
});

it('reports unavailable on failure', async () => {
    orderService.autoDiscount.mockResolvedValue({success: false, status: 504});
    const {result} = renderHook(() => useAutoDiscount(
        {order: order([line()]), active: true, enabled: true, onOrder: jest.fn()}));
    await flush();
    expect(result.current.unavailable).toBe(true);
});

it.each([
    ['disabled', {enabled: false}],
    ['closed', {active: false}],
    ['not a draft', {order: order([line()], {status: 'confirmed'})}],
    ['holding a pending line', {order: order([line({id: 'tmp_x'})])}],
    ['empty', {order: order([])}],
])('never asks when %s', async (_, override) => {
    renderHook(() => useAutoDiscount({order: order([line()]), active: true, enabled: true,
        onOrder: jest.fn(), ...override}));
    await flush();
    expect(orderService.autoDiscount).not.toHaveBeenCalled();
});

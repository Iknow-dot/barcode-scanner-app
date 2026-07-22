jest.mock('../request', () => ({
    __esModule: true,
    default: {
        get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn(),
        put: jest.fn(),
    },
}));

import api from '../request';
import * as orderService from './orderService';
import {getSnapshot, getOps, saveSnapshot} from '../../utils/offlineOrderQueue';
import {isOffline, markOnline} from '../../utils/connectivity';

const ORDER = {id: 42, total: '30.00', items: [{id: 7, sku: 'A1', price: 10, quantity: 3, total: 30}]};
const NET_FAIL = {success: false, error: 'Network Error', code: null, status: null};
const HTTP_FAIL = {success: false, error: 'bad', code: 'SOME_CODE', status: 400};

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({id: 99}));
    markOnline();
});

test('successful getOrder saves a snapshot and marks online', async () => {
    api.get.mockResolvedValue({success: true, data: ORDER, status: 200});
    await orderService.getOrder(42);
    expect(getSnapshot(42)).toEqual(ORDER);
    expect(isOffline()).toBe(false);
});

test('network-failed updateOrderItem queues op and returns optimistic order', async () => {
    saveSnapshot(42, ORDER);
    api.patch.mockResolvedValue(NET_FAIL);
    const result = await orderService.updateOrderItem(42, 7, {quantity: 5});
    expect(result.success).toBe(true);
    expect(result.offline).toBe(true);
    expect(result.data.items[0].quantity).toBe(5);
    expect(result.data.items[0]._pending).toBe(true);
    expect(getOps(42)).toEqual([
        {type: 'update_item', itemId: 7, payload: {quantity: 5}},
    ]);
    expect(isOffline()).toBe(true);
});

test('network-failed addOrderItem queues add_item with a temp id', async () => {
    saveSnapshot(42, ORDER);
    api.post.mockResolvedValue(NET_FAIL);
    const result = await orderService.addOrderItem(42, {sku: 'B2', price: 5, quantity: 2});
    expect(result.success).toBe(true);
    const line = result.data.items[1];
    expect(String(line.id)).toMatch(/^tmp_/);
    expect(getOps(42)[0]).toMatchObject({type: 'add_item', payload: {sku: 'B2'}});
});

test('network-failed removeOrderItem and updateOrder queue their ops', async () => {
    saveSnapshot(42, ORDER);
    api.delete.mockResolvedValue(NET_FAIL);
    api.patch.mockResolvedValue(NET_FAIL);
    await orderService.removeOrderItem(42, 7);
    await orderService.updateOrder(42, {notes: 'x'});
    expect(getOps(42).map((o) => o.type)).toEqual(['remove_item', 'update_order']);
});

test('HTTP errors pass through unchanged and queue nothing', async () => {
    saveSnapshot(42, ORDER);
    api.patch.mockResolvedValue(HTTP_FAIL);
    const result = await orderService.updateOrderItem(42, 7, {quantity: 5});
    expect(result).toEqual(HTTP_FAIL);
    expect(getOps(42)).toHaveLength(0);
});

test('confirm is never queued', async () => {
    saveSnapshot(42, ORDER);
    api.patch.mockResolvedValue(NET_FAIL);
    const result = await orderService.updateOrder(42, {status: 'confirmed'});
    expect(result.success).toBe(false);
    expect(getOps(42)).toHaveLength(0);
});

test('network failure with no snapshot passes through as an error', async () => {
    api.patch.mockResolvedValue(NET_FAIL);
    const result = await orderService.updateOrder(42, {notes: 'x'});
    expect(result.success).toBe(false);
});

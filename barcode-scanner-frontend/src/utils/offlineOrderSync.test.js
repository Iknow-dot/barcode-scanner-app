jest.mock('../api/services/orderService', () => ({
    __esModule: true,
    rawAddOrderItem: jest.fn(),
    rawUpdateOrder: jest.fn(),
    rawUpdateOrderItem: jest.fn(),
    rawRemoveOrderItem: jest.fn(),
    getOrder: jest.fn(),
}));
jest.mock('../api/services/productService', () => ({
    __esModule: true,
    searchProduct: jest.fn(),
}));

import * as orderService from '../api/services/orderService';
import {searchProduct} from '../api/services/productService';
import {enqueueOp, getOps, saveSnapshot, getSnapshot} from './offlineOrderQueue';
import {syncOrder} from './offlineOrderSync';
import {markOnline} from './connectivity';

const ORDER = {id: 42, total: '30.00', items: [{id: 7}]};
const OK = (data) => ({success: true, data, status: 200});
const NET_FAIL = {success: false, error: 'Network Error', code: null, status: null};
const HTTP_FAIL = {success: false, error: 'no stock', code: 'INSUFFICIENT_STOCK', status: 400};

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({id: 99}));
    markOnline();
    saveSnapshot(42, ORDER);
    orderService.getOrder.mockResolvedValue(OK(ORDER));
});

test('replays ops FIFO and refetches the order', async () => {
    enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 5}});
    enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
    orderService.rawUpdateOrderItem.mockResolvedValue(OK(ORDER));
    orderService.rawUpdateOrder.mockResolvedValue(OK(ORDER));

    const result = await syncOrder(42, {userWarehouses: []});

    expect(orderService.rawUpdateOrderItem).toHaveBeenCalledWith(42, 7, {quantity: 5});
    expect(orderService.rawUpdateOrder).toHaveBeenCalledWith(42, {notes: 'x'});
    expect(result).toMatchObject({synced: 2, aborted: false, failures: []});
    expect(getOps(42)).toHaveLength(0);
    expect(orderService.getOrder).toHaveBeenCalledWith(42);
});

test('barcode placeholder resolves product, prefers user warehouse', async () => {
    enqueueOp(42, {type: 'add_item_barcode', tempId: 'tmp_a', barcode: '4870001', quantity: 2});
    searchProduct.mockResolvedValue(OK({
        sku: 'S9', sku_name: 'Thing', article: 'A9', price: 12,
        stock: [
            {warehouse: 'Far', warehouse_code: 'W2', quantity: 5},
            {warehouse: 'Mine', warehouse_code: 'W1', quantity: 3},
        ],
    }));
    orderService.rawAddOrderItem.mockResolvedValue(OK(ORDER));

    const result = await syncOrder(42, {userWarehouses: [{code: 'W1'}]});

    expect(orderService.rawAddOrderItem).toHaveBeenCalledWith(42, {
        sku: 'S9', sku_name: 'Thing', article: 'A9', price: 12,
        quantity: 2, warehouse_code: 'W1', warehouse_name: 'Mine',
    });
    expect(result.synced).toBe(1);
});

test('unresolvable barcode is dropped from queue and reported as failure', async () => {
    enqueueOp(42, {type: 'add_item_barcode', tempId: 'tmp_a', barcode: 'nope', quantity: 1});
    searchProduct.mockResolvedValue({success: false, error: 'not found', code: 'PRODUCT_NOT_FOUND', status: 404});

    const result = await syncOrder(42, {userWarehouses: []});

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].op.type).toBe('add_item_barcode');
    expect(getOps(42)).toHaveLength(0); // queue drains
});

test('HTTP failure drops the op but continues; network failure aborts', async () => {
    enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 5}});
    enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
    orderService.rawUpdateOrderItem.mockResolvedValue(HTTP_FAIL);
    orderService.rawUpdateOrder.mockResolvedValue(NET_FAIL);

    const result = await syncOrder(42, {userWarehouses: []});

    expect(result.aborted).toBe(true);
    expect(result.failures).toHaveLength(1); // the HTTP failure
    expect(getOps(42)).toHaveLength(1);      // network-failed op stays queued
    expect(getOps(42)[0].type).toBe('update_order');
});

test('5xx mid-drain aborts and retains the op in the queue', async () => {
    enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 5}});
    enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
    orderService.rawUpdateOrderItem.mockResolvedValue({success: false, error: 'boom', code: null, status: 500});

    const result = await syncOrder(42, {userWarehouses: []});

    expect(result.aborted).toBe(true);
    expect(result.failures).toHaveLength(0);
    expect(getOps(42)).toHaveLength(2); // nothing dropped
    expect(orderService.rawUpdateOrder).not.toHaveBeenCalled();
});

test('non-404 probe HTTP failure aborts without draining', async () => {
    enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
    orderService.getOrder.mockResolvedValue({success: false, error: 'server error', code: null, status: 500});

    const result = await syncOrder(42, {userWarehouses: []});

    expect(result.aborted).toBe(true);
    expect(getOps(42)).toHaveLength(1); // ops retained
    expect(orderService.rawUpdateOrder).not.toHaveBeenCalled();
});

test('deleted order clears its queue', async () => {
    enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
    orderService.getOrder.mockResolvedValue({success: false, error: 'gone', code: null, status: 404});

    const result = await syncOrder(42, {userWarehouses: []});

    expect(getOps(42)).toHaveLength(0);
    expect(getSnapshot(42)).toBeNull();
    expect(result.failures).toHaveLength(1);
});

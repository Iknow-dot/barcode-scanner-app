import {
    saveSnapshot, getSnapshot, enqueueOp, getOps, removeOp, clearOrder,
    getQueuedOrderIds, pendingCount, makeTempId, applyOpToSnapshot,
} from './offlineOrderQueue';

const ORDER = {
    id: 42,
    total: '30.00',
    items: [{id: 7, sku: 'A1', price: 10, quantity: 3, total: 30}],
};

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({id: 99}));
});

describe('snapshot storage', () => {
    test('save and read a snapshot', () => {
        saveSnapshot(42, ORDER);
        expect(getSnapshot(42)).toEqual(ORDER);
    });

    test('snapshots are scoped per user', () => {
        saveSnapshot(42, ORDER);
        localStorage.setItem('user', JSON.stringify({id: 100}));
        expect(getSnapshot(42)).toBeNull();
    });

    test('corrupt storage returns null, does not throw', () => {
        localStorage.setItem('barcode-scanner.offlineOrders.99', '{not json');
        expect(getSnapshot(42)).toBeNull();
    });
});

describe('op queue', () => {
    test('ops enqueue in FIFO order and count', () => {
        enqueueOp(42, {type: 'remove_item', itemId: 7});
        enqueueOp(42, {type: 'update_order', payload: {notes: 'a'}});
        expect(getOps(42)).toHaveLength(2);
        expect(getOps(42)[0].type).toBe('remove_item');
        expect(pendingCount(42)).toBe(2);
        expect(getQueuedOrderIds()).toEqual(['42']);
    });

    test('update_order payloads collapse into the last update_order op', () => {
        enqueueOp(42, {type: 'update_order', payload: {notes: 'a'}});
        enqueueOp(42, {type: 'update_order', payload: {delivery_address: 'x'}});
        enqueueOp(42, {type: 'update_order', payload: {notes: 'b'}});
        expect(getOps(42)).toHaveLength(1);
        expect(getOps(42)[0].payload).toEqual({notes: 'b', delivery_address: 'x'});
    });

    test('update_item on a temp id merges into the queued add op', () => {
        const tempId = makeTempId();
        enqueueOp(42, {type: 'add_item', tempId, payload: {sku: 'B2', price: 5, quantity: 1}});
        enqueueOp(42, {type: 'update_item', itemId: tempId, payload: {quantity: 4}});
        expect(getOps(42)).toHaveLength(1);
        expect(getOps(42)[0].payload.quantity).toBe(4);
    });

    test('remove_item on a temp id cancels the queued add op', () => {
        const tempId = makeTempId();
        enqueueOp(42, {type: 'add_item_barcode', tempId, barcode: '123', quantity: 1});
        enqueueOp(42, {type: 'remove_item', itemId: tempId});
        expect(getOps(42)).toHaveLength(0);
    });

    test('removeOp removes by index; clearOrder wipes ops and snapshot', () => {
        enqueueOp(42, {type: 'remove_item', itemId: 7});
        enqueueOp(42, {type: 'update_order', payload: {notes: 'a'}});
        removeOp(42, 0);
        expect(getOps(42)).toHaveLength(1);
        expect(getOps(42)[0].type).toBe('update_order');
        clearOrder(42);
        expect(getOps(42)).toHaveLength(0);
        expect(getSnapshot(42)).toBeNull();
        expect(getQueuedOrderIds()).toEqual([]);
    });
});

describe('applyOpToSnapshot', () => {
    test('add_item appends a pending line and recomputes total', () => {
        const next = applyOpToSnapshot(ORDER, {
            type: 'add_item', tempId: 'tmp_x',
            payload: {sku: 'B2', price: 5, quantity: 2},
        });
        expect(next.items).toHaveLength(2);
        expect(next.items[1]).toMatchObject({id: 'tmp_x', _pending: true, total: 10});
        expect(next.total).toBe('40.00');
        expect(next._offline).toBe(true);
        expect(ORDER.items).toHaveLength(1); // pure — input untouched
    });

    test('add_item_barcode appends a barcode-only placeholder', () => {
        const next = applyOpToSnapshot(ORDER, {
            type: 'add_item_barcode', tempId: 'tmp_y', barcode: '4870001', quantity: 1,
        });
        expect(next.items[1]).toMatchObject({
            id: 'tmp_y', sku: '4870001', _pending: true, _barcodeOnly: true, total: 0,
        });
    });

    test('update_item patches, recomputes line and order totals', () => {
        const next = applyOpToSnapshot(ORDER, {
            type: 'update_item', itemId: 7, payload: {quantity: 5},
        });
        expect(next.items[0]).toMatchObject({quantity: 5, total: 50, _pending: true});
        expect(next.total).toBe('50.00');
    });

    test('update_item honors discounted_price for line total', () => {
        const next = applyOpToSnapshot(ORDER, {
            type: 'update_item', itemId: 7, payload: {discounted_price: 8},
        });
        expect(next.items[0].total).toBe(24);
    });

    test('remove_item drops the line', () => {
        const next = applyOpToSnapshot(ORDER, {type: 'remove_item', itemId: 7});
        expect(next.items).toHaveLength(0);
        expect(next.total).toBe('0.00');
    });

    test('update_order shallow-merges fields', () => {
        const next = applyOpToSnapshot(ORDER, {
            type: 'update_order', payload: {notes: 'hello', delivery_type: 'delivery'},
        });
        expect(next.notes).toBe('hello');
        expect(next.delivery_type).toBe('delivery');
    });
});

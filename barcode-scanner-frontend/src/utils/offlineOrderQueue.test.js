import {
    saveSnapshot, getSnapshot, enqueueOp, getOps, removeOp, clearOrder,
    getQueuedOrderIds, pendingCount, makeTempId, applyOpToSnapshot,
    assignOpIds, updateOp, removeOpById, parkOp, getAttention, attentionCount,
    getAttentionOrderIds, retryAttention, discardAttention, holdsTempLine, saveServerOrder,
    recordLanding, landedEdit, startSending, whenSent,
} from './offlineOrderQueue';

// As PurchaseOrderSerializer sends it: a line's amount is `line_total`, a
// decimal string, and a line carries no `total` of its own.
const ORDER = {
    id: 42,
    total: '30.00',
    items: [{id: 7, sku: 'A1', price: '10.00', quantity: 3, effective_price: '10.00', line_total: '30.00'}],
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

    test('an edit of a scanned placeholder keeps every field it sets, not only the quantity', () => {
        // The cart's gift pill and price editor send these for a pending row
        // too; the replay sends them with the resolved line.
        enqueueOp(42, {type: 'add_item_barcode', tempId: 'tmp_a', barcode: '123', quantity: 1});
        enqueueOp(42, {type: 'update_item', itemId: 'tmp_a', payload: {is_gift: true}});
        enqueueOp(42, {
            type: 'update_item', itemId: 'tmp_a', payload: {quantity: 2, discounted_price: 8, discount_percent: 0},
        });

        expect(getOps(42)).toEqual([{
            type: 'add_item_barcode', tempId: 'tmp_a', barcode: '123', quantity: 2,
            payload: {is_gift: true, discounted_price: 8, discount_percent: 0},
        }]);
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

describe('replay bookkeeping', () => {
    // Written by the code before ops carried ids, retry metadata or an
    // attention list: a queue that was sitting in a consultant's browser
    // when this shipped.
    const writeLegacyQueue = () => localStorage.setItem('barcode-scanner.offlineOrders.99', JSON.stringify({
        42: {
            snapshot: ORDER,
            ops: [
                {type: 'update_item', itemId: 7, payload: {quantity: 5}},
                {type: 'add_item_barcode', tempId: 'tmp_a', barcode: '4870001', quantity: 2},
            ],
        },
    }));

    test('an old-format queue still reads, with nothing needing attention', () => {
        writeLegacyQueue();
        expect(getOps(42)).toHaveLength(2);
        expect(getAttention(42)).toEqual([]);
        expect(attentionCount(42)).toBe(0);
        expect(getAttentionOrderIds()).toEqual([]);
    });

    test('assignOpIds gives every op a stable id and keeps the ones it has', () => {
        writeLegacyQueue();
        const first = assignOpIds(42).map((op) => op.id);
        expect(first.every(Boolean)).toBe(true);
        expect(new Set(first).size).toBe(2);
        expect(assignOpIds(42).map((op) => op.id)).toEqual(first);
        expect(getOps(42).map((op) => op.id)).toEqual(first); // persisted
    });

    test('updateOp and removeOpById address an op by id, not position', () => {
        enqueueOp(42, {type: 'remove_item', itemId: 7});
        enqueueOp(42, {type: 'update_order', payload: {notes: 'a'}});
        const [removeId, updateId] = assignOpIds(42).map((op) => op.id);

        updateOp(42, updateId, {attempts: 2, nextAttemptAt: 1234});
        expect(getOps(42)[1]).toMatchObject({type: 'update_order', attempts: 2, nextAttemptAt: 1234});

        removeOpById(42, removeId);
        expect(getOps(42).map((op) => op.id)).toEqual([updateId]);

        removeOpById(42, 'op_gone'); // an op the consultant already cancelled
        expect(getOps(42)).toHaveLength(1);
    });

    test('parkOp takes the op out of the drain and keeps it for the consultant', () => {
        enqueueOp(42, {type: 'add_item_barcode', tempId: 'tmp_a', barcode: '4870001', quantity: 2});
        const [{id}] = assignOpIds(42);

        expect(parkOp(42, id, {reason: 'not_found', product: '4870001'})).toBe(true);
        expect(parkOp(42, 'op_cancelled_meanwhile', {reason: 'not_found'})).toBe(false);

        expect(getOps(42)).toEqual([]);
        expect(pendingCount(42)).toBe(0);
        expect(getQueuedOrderIds()).toEqual([]); // nothing left to replay
        expect(attentionCount(42)).toBe(1);
        expect(getAttentionOrderIds()).toEqual(['42']);
        expect(getAttention(42)[0]).toMatchObject({
            op: {id, type: 'add_item_barcode', barcode: '4870001', quantity: 2},
            reason: 'not_found',
            product: '4870001',
        });
    });

    test('an order holding only parked lines survives with no snapshot', () => {
        enqueueOp(42, {type: 'update_order', payload: {notes: 'a'}});
        const [{id}] = assignOpIds(42);
        parkOp(42, id, {reason: 'rejected'});
        expect(getAttention(42)).toHaveLength(1);
    });

    test('retryAttention puts the op back at the head of the queue with a fresh count', () => {
        enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 5}});
        enqueueOp(42, {type: 'update_order', payload: {notes: 'a'}});
        const [first] = assignOpIds(42);
        updateOp(42, first.id, {attempts: 6, nextAttemptAt: 99, lastReason: 'server_error'});
        parkOp(42, first.id, {reason: 'server_error', attempts: 6});

        expect(retryAttention(42, first.id)).toBe(true);

        expect(getAttention(42)).toEqual([]);
        expect(getOps(42).map((op) => op.type)).toEqual(['update_item', 'update_order']);
        const retried = getOps(42)[0];
        expect(retried.id).toBe(first.id);
        expect(retried.attempts).toBeUndefined();
        expect(retried.nextAttemptAt).toBeUndefined();
        expect(retried.lastReason).toBeUndefined();
        expect(retryAttention(42, 'op_gone')).toBe(false);
    });

    test('discardAttention drops the parked op for good', () => {
        enqueueOp(42, {type: 'add_item_barcode', tempId: 'tmp_a', barcode: 'nope', quantity: 1});
        const [{id}] = assignOpIds(42);
        parkOp(42, id, {reason: 'not_found'});

        discardAttention(42, id);

        expect(getAttention(42)).toEqual([]);
        expect(getOps(42)).toEqual([]);
        expect(getAttentionOrderIds()).toEqual([]);
    });

    test('removing a parked placeholder line cancels the parked add', () => {
        const tempId = makeTempId();
        enqueueOp(42, {type: 'add_item_barcode', tempId, barcode: '123', quantity: 1});
        const [{id}] = assignOpIds(42);
        parkOp(42, id, {reason: 'no_stock'});

        enqueueOp(42, {type: 'remove_item', itemId: tempId});

        expect(getAttention(42)).toEqual([]);
        expect(getOps(42)).toEqual([]); // no DELETE of an id the server never issued
    });

    test('editing a parked placeholder line rewrites the parked add', () => {
        const tempId = makeTempId();
        enqueueOp(42, {type: 'add_item_barcode', tempId, barcode: '123', quantity: 1});
        const [{id}] = assignOpIds(42);
        parkOp(42, id, {reason: 'no_stock'});

        enqueueOp(42, {type: 'update_item', itemId: tempId, payload: {quantity: 3}});

        expect(getOps(42)).toEqual([]);
        expect(getAttention(42)[0].op.quantity).toBe(3);
    });

    test('holdsTempLine: a queued or parked add holds its line, a synced one no longer does', () => {
        enqueueOp(42, {type: 'add_item', tempId: 'tmp_q', payload: {sku: 'B2', quantity: 1}});
        enqueueOp(42, {type: 'add_item_barcode', tempId: 'tmp_p', barcode: '123', quantity: 1});
        const [queued, parked] = assignOpIds(42);
        parkOp(42, parked.id, {reason: 'no_stock'});

        expect(holdsTempLine(42, 'tmp_q')).toBe(true);
        expect(holdsTempLine(42, 'tmp_p')).toBe(true);
        removeOpById(42, queued.id); // what a drain does once the add syncs
        expect(holdsTempLine(42, 'tmp_q')).toBe(false);
        expect(holdsTempLine(42, 'tmp_zz')).toBe(false);
    });

    test('saveServerOrder lays the queued ops over the server order, not the parked ones', () => {
        enqueueOp(42, {type: 'add_item', tempId: 'tmp_q', payload: {sku: 'B2', price: 5, quantity: 1}});
        enqueueOp(42, {type: 'add_item_barcode', tempId: 'tmp_p', barcode: '123', quantity: 1});
        parkOp(42, assignOpIds(42)[1].id, {reason: 'not_found'});

        const saved = saveServerOrder(42, ORDER);

        expect(saved.items.map((item) => item.id)).toEqual([7, 'tmp_q']);
        expect(saved.total).toBe('35.00');
        expect(getSnapshot(42)).toEqual(saved);
    });

    test('saveServerOrder over an order that already shows the queue changes nothing', () => {
        // orderService records every order it reads with the queue laid over
        // it, and the drain lays the queue over its refetch once more.
        enqueueOp(42, {type: 'add_item', tempId: 'tmp_q', payload: {sku: 'B2', price: 5, quantity: 1}});
        enqueueOp(42, {type: 'add_item_barcode', tempId: 'tmp_p', barcode: '123', quantity: 2});
        enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 4}});
        const once = saveServerOrder(42, ORDER);

        expect(saveServerOrder(42, once)).toEqual(once);
        expect(once.items.map((item) => item.id)).toEqual([7, 'tmp_q', 'tmp_p']);
    });

    test('saveServerOrder with nothing queued saves the order as it came', () => {
        expect(saveServerOrder(42, ORDER)).toBe(ORDER);
        expect(getSnapshot(42)).toEqual(ORDER);
    });

    test('clearOrder wipes parked lines too', () => {
        enqueueOp(42, {type: 'update_order', payload: {notes: 'a'}});
        const [{id}] = assignOpIds(42);
        parkOp(42, id, {reason: 'rejected'});
        clearOrder(42);
        expect(getAttention(42)).toEqual([]);
        expect(getAttentionOrderIds()).toEqual([]);
    });
});

describe('a placeholder whose add has landed', () => {
    // Line 7 held 2 units when a placeholder's add of 1 merged into it.
    const MERGED = {...ORDER, items: [{...ORDER.items[0], quantity: 3}]};

    beforeEach(() => saveSnapshot(42, MERGED));

    test('an edit of it is an edit of the line it landed on, by its own units', () => {
        recordLanding(42, 'tmp_a', 7, 1);
        expect(landedEdit(42, {type: 'update_item', itemId: 'tmp_a', payload: {quantity: 4}}))
            .toEqual({type: 'update_item', itemId: 7, payload: {quantity: 6}});
    });

    test('removing it takes back only its own units', () => {
        recordLanding(42, 'tmp_a', 7, 1);
        expect(landedEdit(42, {type: 'remove_item', itemId: 'tmp_a'}))
            .toEqual({type: 'update_item', itemId: 7, payload: {quantity: 2}});
    });

    test('a line that is all its own goes with it, and takes its gift and price edits as they are', () => {
        recordLanding(42, 'tmp_a', 7, 3);
        expect(landedEdit(42, {type: 'remove_item', itemId: 'tmp_a'})).toEqual({type: 'remove_item', itemId: 7});
        expect(landedEdit(42, {type: 'update_item', itemId: 'tmp_a', payload: {is_gift: true}}))
            .toEqual({type: 'update_item', itemId: 7, payload: {is_gift: true}});
    });

    test('a price edit prices the whole line, as the merge itself did', () => {
        recordLanding(42, 'tmp_a', 7, 1);
        expect(landedEdit(42, {type: 'update_item', itemId: 'tmp_a', payload: {discounted_price: 8, discount_percent: 0}}))
            .toEqual({type: 'update_item', itemId: 7, payload: {discounted_price: 8, discount_percent: 0}});
    });

    test('but a gift mark is not put on units the placeholder never held', () => {
        recordLanding(42, 'tmp_a', 7, 1);
        expect(landedEdit(42, {type: 'update_item', itemId: 'tmp_a', payload: {is_gift: true}})).toBeNull();
    });

    test('nothing to go on: no landing recorded, a server id, or a landed line since removed', () => {
        expect(landedEdit(42, {type: 'update_item', itemId: 'tmp_a', payload: {quantity: 2}})).toBeNull();
        expect(landedEdit(42, {type: 'update_item', itemId: 7, payload: {quantity: 2}})).toBeNull();
        recordLanding(42, 'tmp_b', 99, 1);
        expect(landedEdit(42, {type: 'remove_item', itemId: 'tmp_b'})).toBeNull();
    });

    test('edits of the line still queued behind the add take its units on top of theirs', () => {
        // Made while the placeholder stood apart, they set the line's own
        // units; the merge has since added the placeholder's to it.
        enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 4, discount_percent: 5}});
        enqueueOp(42, {type: 'update_item', itemId: 7, payload: {discounted_price: 8}});
        enqueueOp(42, {type: 'update_item', itemId: 8, payload: {quantity: 4}});
        enqueueOp(42, {type: 'remove_item', itemId: 7});
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});

        recordLanding(42, 'tmp_a', 7, 2);

        expect(getOps(42)).toEqual([
            {type: 'update_item', itemId: 7, payload: {quantity: 6, discount_percent: 5}},
            {type: 'update_item', itemId: 7, payload: {discounted_price: 8}},
            {type: 'update_item', itemId: 8, payload: {quantity: 4}},
            {type: 'update_item', itemId: 7, payload: {quantity: 2}},
            {type: 'update_order', payload: {notes: 'x'}},
        ]);
    });

    test('a landing survives new snapshots and goes with clearOrder', () => {
        recordLanding(42, 'tmp_a', 7, 1);
        saveSnapshot(42, MERGED);
        expect(landedEdit(42, {type: 'remove_item', itemId: 'tmp_a'})).not.toBeNull();
        clearOrder(42);
        saveSnapshot(42, MERGED);
        expect(landedEdit(42, {type: 'remove_item', itemId: 'tmp_a'})).toBeNull();
    });
});

test('whenSent settles once the send of a line\'s add has ended, and at once when none is under way', async () => {
    const done = startSending('tmp_a');
    let settled = false;
    whenSent('tmp_a').then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    done();
    await Promise.resolve();
    expect(settled).toBe(true);
    await expect(whenSent('tmp_a')).resolves.toBeUndefined();
    await expect(whenSent('tmp_zz')).resolves.toBeUndefined();
});

describe('totals are counted as the server counts them', () => {
    // Granite pan ×2 at 89.90, as PurchaseOrderSerializer sends it.
    const SERVER_ORDER = {
        id: 42,
        total: '179.80',
        items: [{
            id: 7, sku: 'A1', price: '89.90', quantity: 2, discount_percent: '0.00', discounted_price: null,
            effective_price: '89.90', line_total: '179.80',
        }],
    };

    test('a line still queued adds to the server lines, not in place of them', () => {
        enqueueOp(42, {type: 'add_item', tempId: 'tmp_q', payload: {sku: 'B2', price: 10, quantity: 3}});

        const saved = saveServerOrder(42, SERVER_ORDER);

        expect(saved.items[1]).toMatchObject({id: 'tmp_q', effective_price: '10.00', line_total: '30.00'});
        expect(saved.total).toBe('209.80');
    });

    test('a queued edit re-prices the line it changes', () => {
        enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 3}});

        const saved = saveServerOrder(42, SERVER_ORDER);

        expect(saved.items[0]).toMatchObject({quantity: 3, line_total: '269.70'});
        expect(saved.total).toBe('269.70');
    });

    test('a percent discount counts, as effective_price does', () => {
        const next = applyOpToSnapshot(SERVER_ORDER, {
            type: 'update_item', itemId: 7, payload: {discount_percent: 10, discounted_price: null},
        });

        expect(next.items[0]).toMatchObject({effective_price: '80.91', line_total: '161.82'});
        expect(next.total).toBe('161.82');
    });
});

describe('applyOpToSnapshot', () => {
    test('add_item appends a pending line and recomputes total', () => {
        const next = applyOpToSnapshot(ORDER, {
            type: 'add_item', tempId: 'tmp_x',
            payload: {sku: 'B2', price: 5, quantity: 2},
        });
        expect(next.items).toHaveLength(2);
        expect(next.items[1]).toMatchObject({id: 'tmp_x', _pending: true, line_total: '10.00'});
        expect(next.total).toBe('40.00');
        expect(next._offline).toBe(true);
        expect(ORDER.items).toHaveLength(1); // pure — input untouched
    });

    test('add_item_barcode appends a barcode-only placeholder', () => {
        const next = applyOpToSnapshot(ORDER, {
            type: 'add_item_barcode', tempId: 'tmp_y', barcode: '4870001', quantity: 1,
        });
        expect(next.items[1]).toMatchObject({
            id: 'tmp_y', sku: '4870001', _pending: true, _barcodeOnly: true, line_total: '0.00',
        });
    });

    test('add_item_barcode shows what the consultant changed on it', () => {
        const next = applyOpToSnapshot(ORDER, {
            type: 'add_item_barcode', tempId: 'tmp_y', barcode: '4870001', quantity: 2,
            payload: {is_gift: true, discounted_price: 8},
        });
        expect(next.items[1]).toMatchObject({
            id: 'tmp_y', quantity: 2, is_gift: true, discounted_price: 8, line_total: '16.00', _barcodeOnly: true,
        });
    });

    test('update_item patches, recomputes line and order totals', () => {
        const next = applyOpToSnapshot(ORDER, {
            type: 'update_item', itemId: 7, payload: {quantity: 5},
        });
        expect(next.items[0]).toMatchObject({quantity: 5, line_total: '50.00', _pending: true});
        expect(next.total).toBe('50.00');
    });

    test('update_item honors discounted_price for line total', () => {
        const next = applyOpToSnapshot(ORDER, {
            type: 'update_item', itemId: 7, payload: {discounted_price: 8},
        });
        expect(next.items[0]).toMatchObject({effective_price: '8.00', line_total: '24.00'});
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

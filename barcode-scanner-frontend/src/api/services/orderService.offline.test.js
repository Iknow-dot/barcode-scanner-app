jest.mock('../request', () => ({
    __esModule: true,
    default: {
        get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn(),
        put: jest.fn(),
    },
}));

import api from '../request';
import * as orderService from './orderService';
import {
    getSnapshot, getOps, saveSnapshot, enqueueOp, applyOpToSnapshot, assignOpIds, parkOp,
    removeOpById, getAttention, recordLanding, updateOp,
} from '../../utils/offlineOrderQueue';
import {syncOrder} from '../../utils/offlineOrderSync';
import {isOffline, markOnline} from '../../utils/connectivity';

const ORDER = {id: 42, total: '30.00', items: [{id: 7, sku: 'A1', price: '10.00', quantity: 3, line_total: '30.00'}]};
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

// A line the replay is holding back (a retry backoff, or parked) stays on the
// cart as a placeholder while the app is online, and its stepper and delete
// stay live. The server never issued its tmp_ id — the item routes take
// digits only — so an edit sent there 404s and is lost.
describe('a line that exists only in the queue', () => {
    const QUEUED_ADD = {type: 'add_item', tempId: 'tmp_q', payload: {sku: 'B2', price: 5, quantity: 1}};
    const NOT_FOUND = {success: false, error: 'Not found.', code: null, status: 404};

    beforeEach(() => {
        enqueueOp(42, QUEUED_ADD);
        saveSnapshot(42, applyOpToSnapshot(ORDER, QUEUED_ADD));
        // What the server answers for an item id it never issued.
        api.patch.mockResolvedValue(NOT_FOUND);
        api.delete.mockResolvedValue(NOT_FOUND);
    });

    test('an edit folds into its queued add without a request', async () => {
        const result = await orderService.updateOrderItem(42, 'tmp_q', {quantity: 4});

        expect(api.patch).not.toHaveBeenCalled();
        expect(getOps(42)).toEqual([{...QUEUED_ADD, payload: {...QUEUED_ADD.payload, quantity: 4}}]);
        expect(result.success).toBe(true);
        expect(result.data.items[1]).toMatchObject({id: 'tmp_q', quantity: 4, line_total: '20.00', _pending: true});
        expect(getSnapshot(42)).toEqual(result.data);
        expect(isOffline()).toBe(false); // answered locally, but nothing failed
    });

    test('a remove cancels its queued add without a request', async () => {
        const result = await orderService.removeOrderItem(42, 'tmp_q');

        expect(api.delete).not.toHaveBeenCalled();
        expect(getOps(42)).toEqual([]);
        expect(result.success).toBe(true);
        expect(result.data.items.map((item) => item.id)).toEqual([7]);
        expect(isOffline()).toBe(false);
    });

    describe('while its add is parked', () => {
        beforeEach(() => {
            const [{id}] = assignOpIds(42);
            parkOp(42, id, {reason: 'no_stock', product: 'B2'});
        });

        test('an edit rewrites the parked add and leaves it parked', async () => {
            // A new quantity answers none of the reasons a line is parked for,
            // so it waits for the consultant's Retry now — which then sends the
            // line as it stands now, not as it was first scanned.
            const result = await orderService.updateOrderItem(42, 'tmp_q', {quantity: 4});

            expect(api.patch).not.toHaveBeenCalled();
            expect(result.success).toBe(true);
            expect(getOps(42)).toEqual([]);
            expect(getAttention(42)).toEqual([expect.objectContaining({
                reason: 'no_stock',
                op: expect.objectContaining({tempId: 'tmp_q', payload: {sku: 'B2', price: 5, quantity: 4}}),
            })]);
        });

        test('a remove discards it', async () => {
            const result = await orderService.removeOrderItem(42, 'tmp_q');

            expect(api.delete).not.toHaveBeenCalled();
            expect(result.success).toBe(true);
            expect(getAttention(42)).toEqual([]);
            expect(getOps(42)).toEqual([]);
        });
    });

    test('once its add has left the queue with no word of where it landed, the edit goes to the server as before', async () => {
        // A drain in this tab records where each add lands; one from before
        // that, or in another tab, did not. Nothing is left to fold the edit
        // into, and an op queued behind it would replay against an id the
        // server never issued — so the consultant sees the failure now.
        const [{id}] = assignOpIds(42);
        removeOpById(42, id);

        const result = await orderService.updateOrderItem(42, 'tmp_q', {quantity: 4});

        expect(api.patch).toHaveBeenCalledTimes(1);
        expect(result).toEqual(NOT_FOUND);
        expect(getOps(42)).toEqual([]);
    });
});

// The answer to a live edit is the server's order, which has none of the lines
// still waiting out a retry backoff. They are laid back over it, as the
// drain's refetch does, so the placeholders stay on the cart meanwhile.
describe('a live edit while ops are still queued', () => {
    const HELD_ADD = {
        type: 'add_item', tempId: 'tmp_q', payload: {sku: 'B2', price: 5, quantity: 1},
        attempts: 1, nextAttemptAt: Date.now() + 60000,
    };
    const OK = (data) => ({success: true, data, status: 200});
    const placeholder = expect.objectContaining({id: 'tmp_q', _pending: true});

    beforeEach(() => {
        enqueueOp(42, HELD_ADD);
        saveSnapshot(42, applyOpToSnapshot(ORDER, HELD_ADD));
    });

    test('adding another product keeps the held line on the answer and the snapshot', async () => {
        const withC3 = {...ORDER, total: '32.00', items: [...ORDER.items, {id: 8, sku: 'C3', price: '2.00', quantity: 1, line_total: '2.00'}]};
        api.post.mockResolvedValue(OK(withC3));

        const added = await orderService.addOrderItem(42, {sku: 'C3', price: 2, quantity: 1});

        expect(added.data.items).toEqual([
            expect.objectContaining({id: 7}), expect.objectContaining({id: 8}), placeholder,
        ]);
        expect(added.data.total).toBe('37.00');
        expect(getSnapshot(42)).toEqual(added.data);
        expect(getOps(42)).toEqual([HELD_ADD]); // still the drain's to send
    });

    test('so does editing the order, or several lines at once', async () => {
        api.patch.mockResolvedValue(OK({...ORDER, notes: 'x'}));

        const edited = await orderService.updateOrder(42, {notes: 'x'});
        expect(edited.data.items).toEqual([expect.objectContaining({id: 7}), placeholder]);

        const bulk = await orderService.bulkUpdateOrderItems(42, [7], {discount_percent: 5});
        expect(bulk.data.items).toEqual([expect.objectContaining({id: 7}), placeholder]);
    });

    test('so does reading the order — a drain opens with that read', async () => {
        // A drain can wait out the stock call's whole deadline after its
        // opening read; a placeholder edited meanwhile is answered from the
        // snapshot that read left, which must still hold the other lines.
        const SECOND = {type: 'add_item', tempId: 'tmp_r', payload: {sku: 'C3', price: 2, quantity: 1}};
        enqueueOp(42, SECOND);
        api.get.mockResolvedValue(OK(ORDER));

        const read = await orderService.getOrder(42);
        expect(read.data.items.map((item) => item.id)).toEqual([7, 'tmp_q', 'tmp_r']);

        const edited = await orderService.updateOrderItem(42, 'tmp_q', {quantity: 4});
        expect(edited.data.items.map((item) => item.id)).toEqual([7, 'tmp_q', 'tmp_r']);
        expect(edited.data.items[1]).toMatchObject({quantity: 4});
    });

    test('an edit of a server line waits behind the held add instead, answered from the queue', async () => {
        // A line edit must follow a held add (offlineOrderQueue.js mustFollow):
        // a gift split grows the new line before it shrinks the old one.
        const result = await orderService.updateOrderItem(42, 7, {quantity: 5});

        expect(api.patch).not.toHaveBeenCalled();
        expect(result.data.items).toEqual([
            expect.objectContaining({id: 7, quantity: 5, _pending: true}), placeholder,
        ]);
        expect(result.data.total).toBe('55.00');
        expect(getSnapshot(42)).toEqual(result.data);
        expect(getOps(42)).toEqual([HELD_ADD, {type: 'update_item', itemId: 7, payload: {quantity: 5}}]);
        expect(isOffline()).toBe(false); // nothing failed
    });
});

test('with nothing queued, a live edit answers with the server order as it came', async () => {
    const serverOrder = {...ORDER, items: [{...ORDER.items[0], quantity: 5, line_total: '50.00'}]};
    api.patch.mockResolvedValue({success: true, data: serverOrder, status: 200});

    const result = await orderService.updateOrderItem(42, 7, {quantity: 5});

    expect(result.data).toEqual(serverOrder);
    expect(getSnapshot(42)).toEqual(serverOrder);
});

// The server serves requests concurrently, so it can read an order before a
// write to it commits and still answer after that write's own answer. Taken
// as it comes, that read would undo the write on screen and in the snapshot.
describe('a read that a write to the same order overlapped', () => {
    const OK = (data) => ({success: true, data, status: 200});
    const EDITED = {...ORDER, total: '50.00', items: [{...ORDER.items[0], quantity: 5, line_total: '50.00'}]};
    const settle = async () => {
        for (let i = 0; i < 10; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await Promise.resolve();
        }
    };
    // Holds the next GET until the test answers it with the order as the
    // server read it.
    const holdRead = () => {
        let answer;
        api.get.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
        return (data) => answer(OK(data));
    };

    beforeEach(() => {
        saveSnapshot(42, ORDER);
        api.post.mockResolvedValue(OK(EDITED));
        api.patch.mockResolvedValue(OK(EDITED));
        api.delete.mockResolvedValue(OK(EDITED));
    });

    test('is not saved, and says it is stale, when the write went out while it was out', async () => {
        const answerRead = holdRead();
        const read = orderService.getOrder(42);
        await orderService.updateOrderItem(42, 7, {quantity: 5});

        answerRead(ORDER); // read before the edit committed
        const result = await read;

        expect(result).toMatchObject({success: true, stale: true});
        expect(getSnapshot(42)).toEqual(EDITED);
        expect(isOffline()).toBe(false);
    });

    test('nor when the write went out first and was answered while it was out', async () => {
        let answerWrite;
        api.patch.mockReturnValueOnce(new Promise((resolve) => { answerWrite = resolve; }));
        const write = orderService.updateOrderItem(42, 7, {quantity: 5});
        await settle();
        expect(api.patch).toHaveBeenCalledTimes(1);
        const answerRead = holdRead();
        const read = orderService.getOrder(42);

        answerWrite(OK(EDITED));
        await write;
        answerRead(ORDER);

        expect(await read).toMatchObject({stale: true});
        expect(getSnapshot(42)).toEqual(EDITED);
    });

    test.each([
        ['an add', () => orderService.addOrderItem(42, {sku: 'B2', price: 5, quantity: 1})],
        ['a removal', () => orderService.removeOrderItem(42, 7)],
        ['an order edit', () => orderService.updateOrder(42, {notes: 'x'})],
        ['a bulk line edit', () => orderService.bulkUpdateOrderItems(42, [7], {discount_percent: 5})],
        ['deleting the order', () => orderService.deleteOrder(42)],
        ['a queued edit the drain replays', () => orderService.rawUpdateOrderItem(42, 7, {quantity: 5})],
    ])('%s counts as a write', async (label, send) => {
        const answerRead = holdRead();
        const read = orderService.getOrder(42);
        await send();

        answerRead(ORDER);

        expect(await read).toMatchObject({stale: true});
    });

    test('a write to another order does not count', async () => {
        api.patch.mockResolvedValueOnce(OK({...EDITED, id: 43}));
        const answerRead = holdRead();
        const read = orderService.getOrder(42);
        await orderService.updateOrderItem(43, 7, {quantity: 5});

        answerRead(EDITED);
        const result = await read;

        expect(result.stale).toBeUndefined();
        expect(getSnapshot(42)).toEqual(EDITED);
    });

    test('nor does one answered before the read went out', async () => {
        await orderService.updateOrderItem(42, 7, {quantity: 5});
        api.get.mockResolvedValueOnce(OK(EDITED));

        const result = await orderService.getOrder(42);

        expect(result.stale).toBeUndefined();
        expect(result.data).toEqual(EDITED);
    });
});

// The drain and the cart together, over a server that answers as
// core/views/orders.py does: every item route answers with the whole order,
// an add merges into the first line with its SKU, gift flag and warehouse,
// and the item routes take digit ids only. `holdAdds` keeps each add's
// answer back until the test lets it through; `holdReads` does the same for
// each GET, which reads the order when it arrives, not when it is answered.
const fakeServer = (initial) => {
    let order = initial;
    let nextId = 77;
    const held = [];
    const heldReads = [];
    const priced = (items) => items.map((item) => ({
        ...item, line_total: (Number(item.price) * item.quantity).toFixed(2),
    }));
    const put = (items) => {
        order = {...order, items: priced(items)};
        return {success: true, data: order, status: 200};
    };
    const lineOf = (url) => order.items.find((item) => url.endsWith(`/items/${item.id}/`)
        || url.endsWith(`/items/${item.id}/update/`));
    const NOT_FOUND = {success: false, error: 'Item not found.', code: null, status: 404};
    const add = (data) => {
        const same = order.items.find((item) => item.sku === data.sku
            && Boolean(item.is_gift) === Boolean(data.is_gift)
            && (!data.warehouse_code || item.warehouse_code === data.warehouse_code));
        const quantity = data.quantity ?? 1;
        return put(same
            ? order.items.map((item) => (item === same ? {...item, quantity: item.quantity + quantity} : item))
            : [...order.items, {is_gift: false, ...data, quantity, id: nextId++}]); // eslint-disable-line no-plusplus
    };
    const server = {
        holdAdds: false,
        holdReads: false,
        get order() { return order; },
        releaseAdd: (answer) => held.shift()(answer),
        releaseRead: () => heldReads.shift()(),
    };
    api.get.mockImplementation(() => {
        const read = {success: true, data: order, status: 200};
        if (!server.holdReads) return Promise.resolve(read);
        return new Promise((resolve) => heldReads.push(() => resolve(read)));
    });
    api.post.mockImplementation((url, data) => {
        if (!server.holdAdds) return Promise.resolve(add(data));
        return new Promise((resolve) => held.push((answer) => resolve(answer || add(data))));
    });
    api.patch.mockImplementation(async (url, data) => {
        if (!url.includes('/items/')) {
            order = {...order, ...data};
            return {success: true, data: order, status: 200};
        }
        const line = lineOf(url);
        if (!line) return NOT_FOUND;
        return put(order.items.map((item) => (item === line ? {...item, ...data} : item)));
    });
    api.delete.mockImplementation(async (url) => {
        const line = lineOf(url);
        if (!line) return NOT_FOUND;
        return put(order.items.filter((item) => item !== line));
    });
    return server;
};

const flush = async (rounds = 50) => {
    for (let i = 0; i < rounds; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};

const B2 = {sku: 'B2', price: '5.00', warehouse_code: 'W1'};
const queueAdd = (quantity = 1) => {
    const op = {type: 'add_item', tempId: 'tmp_q', payload: {...B2, quantity}};
    enqueueOp(42, op);
    saveSnapshot(42, applyOpToSnapshot(ORDER, op));
};
const quantityOf = (server, sku) => server.order.items
    .filter((item) => item.sku === sku)
    .reduce((sum, item) => sum + item.quantity, 0);

// An edit of a placeholder made while the drain has its add in the air: the
// answer decides whether the line is still the queue's or now the server's.
describe('a line whose add the drain is sending right now', () => {
    test('an edit waits for the answer, then lands on the line the add became', async () => {
        const server = fakeServer(ORDER);
        server.holdAdds = true;
        queueAdd(1);

        const drain = syncOrder(42, {userWarehouses: []});
        await flush();
        expect(api.post).toHaveBeenCalledTimes(1);
        const edit = orderService.updateOrderItem(42, 'tmp_q', {quantity: 3});
        await flush();
        expect(api.patch).not.toHaveBeenCalled();

        server.releaseAdd();
        const [result] = await Promise.all([edit, drain]);

        expect(api.patch).toHaveBeenCalledWith('api/v1/orders/42/items/77/update/', {quantity: 3});
        expect(quantityOf(server, 'B2')).toBe(3);
        expect(result.data.items.map((item) => item.id)).toEqual([7, 77]);
        expect(getOps(42)).toEqual([]);
    });

    test('a removal waits too, and takes back only the units the placeholder brought', async () => {
        // Two of B2 were on the order already, so the add merges into their line.
        const server = fakeServer({...ORDER, items: [...ORDER.items, {...B2, id: 9, quantity: 2, is_gift: false}]});
        server.holdAdds = true;
        queueAdd(1);

        const drain = syncOrder(42, {userWarehouses: []});
        await flush();
        const removal = orderService.removeOrderItem(42, 'tmp_q');
        await flush();
        server.releaseAdd();
        const [result] = await Promise.all([removal, drain]);

        expect(result.success).toBe(true);
        expect(api.delete).not.toHaveBeenCalled();
        expect(quantityOf(server, 'B2')).toBe(2);
        expect(getOps(42)).toEqual([]);
    });

    test('an add answered with a retry takes the edit into itself instead', async () => {
        const server = fakeServer(ORDER);
        server.holdAdds = true;
        queueAdd(1);

        const drain = syncOrder(42, {userWarehouses: []});
        await flush();
        const edit = orderService.updateOrderItem(42, 'tmp_q', {quantity: 3});
        await flush();
        server.releaseAdd({success: false, error: 'Bad Gateway', code: null, status: 502});
        const [result] = await Promise.all([edit, drain]);

        expect(api.patch).not.toHaveBeenCalled();
        expect(result.data.items[1]).toMatchObject({id: 'tmp_q', quantity: 3, _pending: true});
        expect(getOps(42)).toEqual([expect.objectContaining({
            tempId: 'tmp_q', payload: {...B2, quantity: 3}, attempts: 1,
        })]);
        expect(quantityOf(server, 'B2')).toBe(0);
    });
});

// The open cart can keep showing a placeholder after its add landed: the drain
// is cut short before its refetch, or the cart does not take it.
describe('a placeholder still on screen after its add landed', () => {
    test('an edit goes to the line it became, keeping the units already there', async () => {
        const server = fakeServer({...ORDER, items: [...ORDER.items, {...B2, id: 9, quantity: 3, is_gift: false}]});
        saveSnapshot(42, server.order);
        recordLanding(42, 'tmp_q', 9, 1); // it brought one of line 9's three

        const result = await orderService.updateOrderItem(42, 'tmp_q', {quantity: 2});

        expect(api.patch).toHaveBeenCalledWith('api/v1/orders/42/items/9/update/', {quantity: 4});
        expect(result.data.items.map((item) => [item.id, item.quantity])).toEqual([[7, 3], [9, 4]]);
    });

    test('offline, its removal waits in the queue against that line, and is replayed there', async () => {
        const server = fakeServer(ORDER);
        queueAdd(1);
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
        // The add lands; the network drops before the notes go out, so the
        // drain never refetches and the cart still shows tmp_q.
        api.patch.mockResolvedValueOnce(NET_FAIL);
        const cut = await syncOrder(42, {userWarehouses: []});
        expect(cut.aborted).toBe(true);
        expect(isOffline()).toBe(true);

        api.delete.mockResolvedValueOnce(NET_FAIL);
        const removal = await orderService.removeOrderItem(42, 'tmp_q');

        expect(removal.success).toBe(true);
        expect(removal.data.items.map((item) => item.id)).toEqual([7]);
        expect(getOps(42).map((op) => [op.type, op.itemId])).toEqual([
            ['update_order', undefined], ['remove_item', 77],
        ]);

        markOnline();
        const replay = await syncOrder(42, {userWarehouses: []});

        expect(replay).toMatchObject({synced: 2, failures: []});
        expect(server.order.items.map((item) => item.id)).toEqual([7]);
        expect(getOps(42)).toEqual([]);
    });
});

// The drain ends by reading the order back. A live edit made in the open cart
// meanwhile can commit after the server read the order and be answered
// before that read is: the edit's answer is then the newer of the two.
describe('a live edit answered while the drain reads the order back', () => {
    const lineOf = (order) => order.items.find((item) => item.id === 7);

    // Wrapped, since an async function resolving to a promise would wait for it.
    const drainUntilItsRefetchIsOut = async (server) => {
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
        const drain = syncOrder(42, {userWarehouses: []});
        server.holdReads = true; // the opening read went out already
        await flush();
        expect(api.patch).toHaveBeenCalledTimes(1); // the notes replayed
        expect(api.get).toHaveBeenCalledTimes(2); // and the refetch is out
        return {drain};
    };

    test('is not undone by a read the server made before the edit committed', async () => {
        const server = fakeServer(ORDER);
        const {drain} = await drainUntilItsRefetchIsOut(server);

        const edit = await orderService.updateOrderItem(42, 7, {quantity: 5});
        expect(lineOf(edit.data).quantity).toBe(5);
        server.holdReads = false;
        server.releaseRead(); // notes x, quantity 3: read before the edit
        const result = await drain;

        expect(result.order.notes).toBe('x');
        expect(lineOf(result.order).quantity).toBe(5);
        expect(getSnapshot(42)).toEqual(result.order);
    });

    test('and when the read after it is overlapped too, the drain hands back no order', async () => {
        const server = fakeServer(ORDER);
        const {drain} = await drainUntilItsRefetchIsOut(server);

        await orderService.updateOrderItem(42, 7, {quantity: 5});
        server.releaseRead();
        await flush();
        expect(api.get).toHaveBeenCalledTimes(3); // read again, and held again
        const second = await orderService.updateOrderItem(42, 7, {quantity: 6});
        server.releaseRead(); // quantity 5: read before the second edit
        const result = await drain;

        expect(result).toMatchObject({synced: 1, order: null, pending: 0});
        expect(getSnapshot(42)).toEqual(second.data);
        expect(lineOf(getSnapshot(42)).quantity).toBe(6);
    });

    test('with no edit meanwhile, the drain hands back and saves its refetch as before', async () => {
        const server = fakeServer(ORDER);
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});

        const result = await syncOrder(42, {userWarehouses: []});

        expect(api.get).toHaveBeenCalledTimes(2); // the opening read and the refetch, no more
        expect(result.order).toEqual(server.order);
        expect(result.order.notes).toBe('x');
        expect(getSnapshot(42)).toEqual(server.order);
    });
});

// A queued op can wait out a retry backoff for minutes while the app is online
// and the cart stays live. A change sent then would reach the server before
// the op queued ahead of it, whose replay would land over it: so a change that
// must follow a queued op (offlineOrderQueue.js mustFollow) waits behind it in
// the queue, as one made offline does, and the drain sends both in turn.
describe('a live change while an op it must follow is still queued', () => {
    const hold = (op) => {
        enqueueOp(42, {...op, attempts: 1, nextAttemptAt: Date.now() + 60000});
        saveSnapshot(42, applyOpToSnapshot(getSnapshot(42) || ORDER, op));
    };
    const backoffRunsOut = () => assignOpIds(42).forEach((op) => updateOp(42, op.id, {nextAttemptAt: 0}));

    test('an edit of a line waits behind a held edit of it, so the replay cannot undo it', async () => {
        const server = fakeServer(ORDER);
        hold({type: 'update_item', itemId: 7, payload: {quantity: 5}});

        const result = await orderService.updateOrderItem(42, 7, {quantity: 6});

        expect(api.patch).not.toHaveBeenCalled();
        expect(result.success).toBe(true);
        expect(result.data.items).toEqual([expect.objectContaining({id: 7, quantity: 6, _pending: true})]);
        expect(isOffline()).toBe(false); // nothing failed

        backoffRunsOut();
        await syncOrder(42, {userWarehouses: []});

        expect(api.patch.mock.calls.map(([, data]) => data)).toEqual([{quantity: 5}, {quantity: 6}]);
        expect(server.order.items[0].quantity).toBe(6);
    });

    test('an add waits behind a held removal, which would otherwise take the new units with it', async () => {
        // The server merges an add into the line with its SKU, so sent now it
        // would land on line 7, which the removal then deletes.
        const server = fakeServer(ORDER);
        hold({type: 'remove_item', itemId: 7});

        const result = await orderService.addOrderItem(42, {sku: 'A1', price: '10.00', quantity: 1});

        expect(api.post).not.toHaveBeenCalled();
        expect(result.data.items).toEqual([expect.objectContaining({sku: 'A1', quantity: 1, _pending: true})]);

        backoffRunsOut();
        await syncOrder(42, {userWarehouses: []});

        expect(server.order.items).toEqual([expect.objectContaining({sku: 'A1', quantity: 1})]);
    });

    test('an order edit folds into a held one, so the older value cannot win', async () => {
        const server = fakeServer(ORDER);
        hold({type: 'update_order', payload: {notes: 'A'}});

        const result = await orderService.updateOrder(42, {notes: 'B'});

        expect(api.patch).not.toHaveBeenCalled();
        expect(result.data.notes).toBe('B');
        expect(getOps(42)).toEqual([expect.objectContaining({type: 'update_order', payload: {notes: 'B'}})]);

        backoffRunsOut();
        await syncOrder(42, {userWarehouses: []});

        expect(server.order.notes).toBe('B');
    });

    test('what need not follow a held op still goes out at once', async () => {
        fakeServer(ORDER);
        hold({type: 'add_item', tempId: 'tmp_q', payload: {sku: 'B2', price: 5, quantity: 1}});
        await orderService.addOrderItem(42, {sku: 'C3', price: '2.00', quantity: 1}); // adds pass adds
        expect(api.post).toHaveBeenCalledTimes(1);

        hold({type: 'remove_item', itemId: 7});
        await orderService.updateOrder(42, {notes: 'x'}); // order details touch no line
        expect(api.patch).toHaveBeenCalledWith('api/v1/orders/42/', {notes: 'x'});

        expect(getOps(42).map((op) => op.type)).toEqual(['add_item', 'remove_item']);
    });

    test('and a line edit is not held back by a held order edit', async () => {
        fakeServer(ORDER);
        hold({type: 'update_order', payload: {notes: 'A'}});

        await orderService.updateOrderItem(42, 7, {quantity: 6});

        expect(api.patch).toHaveBeenCalledWith('api/v1/orders/42/items/7/update/', {quantity: 6});
    });

    test('confirming is never queued, whatever waits', async () => {
        fakeServer(ORDER);
        hold({type: 'update_order', payload: {notes: 'A'}});

        await orderService.updateOrder(42, {status: 'confirmed'});

        expect(api.patch).toHaveBeenCalledWith('api/v1/orders/42/', {status: 'confirmed'});
    });

    test('a parked op holds nothing back: only the consultant\'s Retry sends it again', async () => {
        fakeServer(ORDER);
        hold({type: 'update_item', itemId: 7, payload: {quantity: 5}});
        const [{id}] = assignOpIds(42);
        parkOp(42, id, {reason: 'rejected'});

        await orderService.updateOrderItem(42, 7, {quantity: 6});

        expect(api.patch).toHaveBeenCalledWith('api/v1/orders/42/items/7/update/', {quantity: 6});
    });

    // The held add has line 7's SKU and no other warehouse or gift flag, so the
    // server merges it into line 7. The consultant set line 7 while the add
    // still stood apart from it as a placeholder: what they set is the line's
    // own units, and the placeholder's come on top once the add lands.
    describe('behind a held add the server will merge into the edited line', () => {
        const HELD_A1 = {type: 'add_item', tempId: 'tmp_q', payload: {sku: 'A1', price: '10.00', quantity: 1}};

        test('a quantity edit keeps the units the add brings', async () => {
            const server = fakeServer(ORDER);
            hold(HELD_A1);

            const result = await orderService.updateOrderItem(42, 7, {quantity: 4});
            expect(api.patch).not.toHaveBeenCalled();
            expect(result.data.items.reduce((sum, item) => sum + item.quantity, 0)).toBe(5);

            backoffRunsOut();
            const drain = await syncOrder(42, {userWarehouses: []});

            expect(quantityOf(server, 'A1')).toBe(5);
            expect(drain.order.items).toEqual([expect.objectContaining({id: 7, quantity: 5})]);
        });

        test('a removal takes back only the line\'s own units', async () => {
            const server = fakeServer(ORDER);
            hold(HELD_A1);

            const result = await orderService.removeOrderItem(42, 7);
            expect(result.data.items).toEqual([expect.objectContaining({id: 'tmp_q', quantity: 1})]);

            backoffRunsOut();
            await syncOrder(42, {userWarehouses: []});

            expect(server.order.items).toEqual([expect.objectContaining({id: 7, sku: 'A1', quantity: 1})]);
        });

        test('a gift split\'s shrink of the paid line keeps them too', async () => {
            // giftSplit.js: add one gift unit (adds pass adds, so it goes out
            // now), then shrink the paid line, which waits behind the held add.
            const server = fakeServer(ORDER);
            hold(HELD_A1);

            await orderService.addOrderItem(42, {sku: 'A1', price: '10.00', quantity: 1, is_gift: true});
            await orderService.updateOrderItem(42, 7, {quantity: 2});
            backoffRunsOut();
            await syncOrder(42, {userWarehouses: []});

            expect(server.order.items.map((item) => [item.id, Boolean(item.is_gift), item.quantity])).toEqual([
                [7, false, 3], [77, true, 1],
            ]);
        });
    });
});

// Two writes to one order can be served side by side, so the answer to one
// may predate the other's commit and still arrive after the other's answer:
// a write says so when another write to its order was sent or answered while
// it was out, and the drain does not save such an answer over the snapshot.
describe('a write that another write to its order overlapped', () => {
    const OK = (data) => ({success: true, data, status: 200});

    test('says so', async () => {
        saveSnapshot(42, ORDER);
        let answer;
        api.patch.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
        api.post.mockResolvedValue(OK(ORDER));
        const first = orderService.rawUpdateOrderItem(42, 7, {quantity: 5});
        await orderService.addOrderItem(42, {sku: 'C3', price: '2.00', quantity: 1});

        answer(OK(ORDER));

        expect(await first).toMatchObject({success: true, overlapped: true});
    });

    test('a write alone, or beside one to another order, does not', async () => {
        saveSnapshot(42, ORDER);
        let answer;
        api.patch.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
        api.post.mockResolvedValue(OK({...ORDER, id: 43}));
        const first = orderService.rawUpdateOrderItem(42, 7, {quantity: 5});
        await orderService.addOrderItem(43, {sku: 'C3', price: '2.00', quantity: 1});

        answer(OK(ORDER));

        expect((await first).overlapped).toBeUndefined();
        api.patch.mockResolvedValueOnce(OK(ORDER));
        expect((await orderService.rawUpdateOrderItem(42, 7, {quantity: 6})).overlapped).toBeUndefined();
    });

    test('a replayed add a live add overlapped does not take the live one off the snapshot', async () => {
        // The replay of B2 commits first; the live add of C3 commits after it
        // and is answered before it. The replay's answer, without C3, is the
        // older of the two, and the drain's closing read then fails: nothing
        // else would put C3 back before the next drain.
        queueAdd(1);
        const withB2 = {...ORDER, items: [...ORDER.items, {...B2, id: 77, quantity: 1, line_total: '5.00'}]};
        const withBoth = {
            ...withB2,
            items: [...withB2.items, {id: 78, sku: 'C3', price: '2.00', quantity: 1, line_total: '2.00'}],
        };
        let answerReplay;
        api.get.mockResolvedValueOnce(OK(ORDER)).mockResolvedValueOnce(NET_FAIL);
        api.post
            .mockReturnValueOnce(new Promise((resolve) => { answerReplay = resolve; }))
            .mockResolvedValueOnce(OK(withBoth));

        const drain = syncOrder(42, {userWarehouses: []});
        await flush();
        expect(api.post).toHaveBeenCalledTimes(1); // the replay is out
        const live = await orderService.addOrderItem(42, {sku: 'C3', price: '2.00', quantity: 1});
        expect(live.data.items.map((item) => item.id)).toContain(78);
        answerReplay(OK(withB2));
        const result = await drain;

        expect(result).toMatchObject({synced: 1, order: null});
        expect(getSnapshot(42).items.map((item) => item.id)).toEqual(expect.arrayContaining([7, 77, 78]));
    });
});

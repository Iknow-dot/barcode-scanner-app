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
    fetchStock: jest.fn(),
}));

import * as orderService from '../api/services/orderService';
import {searchProduct, fetchStock} from '../api/services/productService';
import {
    enqueueOp, getOps, saveSnapshot, getSnapshot, getAttention, assignOpIds, parkOp,
    retryAttention, discardAttention, applyOpToSnapshot, landedEdit, whenSent, updateOp,
} from './offlineOrderQueue';
import {
    syncOrder, startSyncLoop, requestSync, MAX_REPLAY_ATTEMPTS, RETRY_DELAYS_MS,
} from './offlineOrderSync';
import {markOffline, markOnline, isOffline} from './connectivity';

const ORDER = {
    id: 42,
    total: '30.00',
    items: [{id: 7, sku: 'A1', sku_name: 'Pan', price: '10.00', quantity: 3, line_total: '30.00'}],
};
const OK = (data) => ({success: true, data, status: 200});
const NET_FAIL = {success: false, error: 'Network Error', code: null, status: null};
const HTTP_FAIL = {success: false, error: 'no stock', code: 'INSUFFICIENT_STOCK', status: 400};
const SERVER_FAIL = {success: false, error: 'boom', code: null, status: 500};

const CATALOG_HIT = OK({sku: 'S9', sku_name: 'Thing', article: 'A9', price: 12});
const CATALOG_MISS = {success: false, error: 'not in catalog', status: 404, code: 'PRODUCT_NOT_IN_CATALOG'};
const stockAnswer = (status, extra = {}) => OK({results: [{sku: '4870001', status, stock: [], ...extra}]});
const STOCK_IN_W1 = stockAnswer('ok', {stock: [{warehouse: 'W1', warehouse_name: 'Mine', quantity: 3}]});

const T0 = 1800000000000;

// Drains the microtask queue without resolving any pending promise, so a
// test can inspect "has this mock been called yet" while another mock's
// promise is deliberately left unresolved.
const flushMicrotasks = async (rounds = 5) => {
    for (let i = 0; i < rounds; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};

let nowSpy = null;
const setNow = (ms) => {
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(ms);
};

const queueBarcode = (extra = {}) => enqueueOp(42, {
    type: 'add_item_barcode', tempId: 'tmp_a', barcode: '4870001', quantity: 2, ...extra,
});

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({id: 99}));
    markOnline();
    saveSnapshot(42, ORDER);
    orderService.getOrder.mockResolvedValue(OK(ORDER));
});

afterEach(() => {
    if (nowSpy) nowSpy.mockRestore();
    nowSpy = null;
});

test('replays ops FIFO and refetches the order', async () => {
    enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 5}});
    enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
    orderService.rawUpdateOrderItem.mockResolvedValue(OK(ORDER));
    orderService.rawUpdateOrder.mockResolvedValue(OK(ORDER));

    const result = await syncOrder(42, {userWarehouses: []});

    expect(orderService.rawUpdateOrderItem).toHaveBeenCalledWith(42, 7, {quantity: 5});
    expect(orderService.rawUpdateOrder).toHaveBeenCalledWith(42, {notes: 'x'});
    expect(result).toMatchObject({synced: 2, aborted: false, failures: [], pending: 0});
    expect(getOps(42)).toHaveLength(0);
    expect(orderService.getOrder).toHaveBeenCalledWith(42);
});

test('barcode placeholder resolves product and prefers the user warehouse', async () => {
    queueBarcode();
    searchProduct.mockResolvedValue(CATALOG_HIT);
    fetchStock.mockResolvedValue(OK({results: [{
        sku: '4870001', status: 'ok', stock: [
            {warehouse: 'W2', warehouse_name: 'Far', quantity: 5},
            {warehouse: 'W1', warehouse_name: 'Mine', quantity: 3},
        ],
    }]}));
    orderService.rawAddOrderItem.mockResolvedValue(OK(ORDER));

    const result = await syncOrder(42, {userWarehouses: [{code: 'W1'}]});

    expect(orderService.rawAddOrderItem).toHaveBeenCalledWith(42, {
        sku: 'S9', sku_name: 'Thing', article: 'A9', price: 12,
        quantity: 2, warehouse_code: 'W1', warehouse_name: 'Mine',
    });
    expect(result.synced).toBe(1);
});

test('the catalog read and the stock call go out in parallel', async () => {
    queueBarcode({quantity: 1});
    // Leave searchProduct pending on purpose: a sequential implementation
    // (`await searchProduct(); ...; await fetchStock();`) would not call
    // fetchStock until this promise resolves, so it would still show zero
    // calls below. Only a genuinely parallel `Promise.all([...])` invokes
    // both before either settles.
    let resolveSearch;
    searchProduct.mockReturnValue(new Promise((resolve) => { resolveSearch = resolve; }));
    fetchStock.mockResolvedValue(STOCK_IN_W1);
    orderService.rawAddOrderItem.mockResolvedValue(OK(ORDER));

    const syncPromise = syncOrder(42, {userWarehouses: [{code: 'W1'}]});
    await flushMicrotasks();

    expect(fetchStock).toHaveBeenCalledTimes(1); // already fired, searchProduct still pending

    resolveSearch(OK({sku: 'S9', sku_name: 'T', article: 'A9', price: 1}));
    await syncPromise;

    expect(searchProduct).toHaveBeenCalledTimes(1);
});

test('what the consultant changed on a scanned line goes out with it', async () => {
    // A gift mark or discount set on the pending row, folded into its add.
    queueBarcode({payload: {is_gift: true, discount_percent: 10, discounted_price: null}});
    searchProduct.mockResolvedValue(CATALOG_HIT);
    fetchStock.mockResolvedValue(STOCK_IN_W1);
    orderService.rawAddOrderItem.mockResolvedValue(OK(ORDER));

    await syncOrder(42, {userWarehouses: [{code: 'W1'}]});

    expect(orderService.rawAddOrderItem).toHaveBeenCalledWith(42, {
        sku: 'S9', sku_name: 'Thing', article: 'A9', price: 12,
        quantity: 2, warehouse_code: 'W1', warehouse_name: 'Mine',
        is_gift: true, discount_percent: 10, discounted_price: null,
    });
});

test('a scanned product with no article or names goes out without them, not as blanks', async () => {
    // AddOrderItemSerializer's CharFields reject '' and default a missing
    // field to '' themselves — a blank would park the line as rejected, and
    // Retry now could never get it through.
    queueBarcode();
    searchProduct.mockResolvedValue(OK({sku: 'S9', sku_name: '', article: '', price: 12}));
    fetchStock.mockResolvedValue(stockAnswer('ok', {stock: [{warehouse: 'W1', warehouse_name: '', quantity: 3}]}));
    orderService.rawAddOrderItem.mockResolvedValue(OK(ORDER));

    await syncOrder(42, {userWarehouses: [{code: 'W1'}]});

    expect(orderService.rawAddOrderItem).toHaveBeenCalledWith(42, {
        sku: 'S9', price: 12, quantity: 2, warehouse_code: 'W1',
    });
});

describe('a scanned line changed while its lookup is out', () => {
    let answerStock;

    beforeEach(() => {
        queueBarcode({quantity: 1});
        searchProduct.mockResolvedValue(CATALOG_HIT);
        fetchStock.mockReturnValue(new Promise((resolve) => { answerStock = resolve; }));
        orderService.rawAddOrderItem.mockResolvedValue(OK(ORDER));
    });

    test('goes out as it stands once the lookup answers', async () => {
        // The lookup can wait out the stock call's whole deadline.
        const drain = syncOrder(42, {userWarehouses: [{code: 'W1'}]});
        await flushMicrotasks();
        enqueueOp(42, {type: 'update_item', itemId: 'tmp_a', payload: {quantity: 3, is_gift: true}});
        answerStock(STOCK_IN_W1);
        const result = await drain;

        expect(orderService.rawAddOrderItem).toHaveBeenCalledWith(42, expect.objectContaining({
            sku: 'S9', quantity: 3, is_gift: true,
        }));
        expect(result.synced).toBe(1);
    });

    test('and one the consultant removed meanwhile does not go out at all', async () => {
        const drain = syncOrder(42, {userWarehouses: [{code: 'W1'}]});
        await flushMicrotasks();
        enqueueOp(42, {type: 'remove_item', itemId: 'tmp_a'});
        answerStock(STOCK_IN_W1);
        const result = await drain;

        expect(orderService.rawAddOrderItem).not.toHaveBeenCalled();
        expect(result).toMatchObject({synced: 0, failures: []});
        expect(getOps(42)).toEqual([]);
    });
});

describe('where an add lands', () => {
    // Line 7 now in W1: a paid line of 3, and a gift line 8 of 1.
    const WITH_GIFT = {
        ...ORDER,
        items: [
            {...ORDER.items[0], warehouse_code: 'W1', is_gift: false},
            {id: 8, sku: 'A1', sku_name: 'Pan', price: '10.00', quantity: 1, warehouse_code: 'W1', is_gift: true, line_total: '10.00'},
        ],
    };
    const withQuantity = (order, id, quantity) => ({
        ...order,
        items: order.items.map((item) => (item.id === id ? {...item, quantity} : item)),
    });

    test('is remembered: the placeholder still on screen edits the line it merged into', async () => {
        saveSnapshot(42, WITH_GIFT);
        enqueueOp(42, {type: 'add_item', tempId: 'tmp_b', payload: {sku: 'A1', quantity: 2, warehouse_code: 'W1'}});
        const landed = withQuantity(WITH_GIFT, 7, 5);
        orderService.rawAddOrderItem.mockResolvedValue(OK(landed));
        orderService.getOrder.mockResolvedValue(OK(landed));

        await syncOrder(42, {userWarehouses: []});

        expect(landedEdit(42, {type: 'remove_item', itemId: 'tmp_b'}))
            .toEqual({type: 'update_item', itemId: 7, payload: {quantity: 3}});
    });

    test('a gift add lands on the gift line, never the paid one', async () => {
        saveSnapshot(42, WITH_GIFT);
        enqueueOp(42, {
            type: 'add_item', tempId: 'tmp_g', payload: {sku: 'A1', quantity: 1, warehouse_code: 'W1', is_gift: true},
        });
        const landed = withQuantity(WITH_GIFT, 8, 2);
        orderService.rawAddOrderItem.mockResolvedValue(OK(landed));
        orderService.getOrder.mockResolvedValue(OK(landed));

        await syncOrder(42, {userWarehouses: []});

        expect(landedEdit(42, {type: 'update_item', itemId: 'tmp_g', payload: {quantity: 3}}))
            .toEqual({type: 'update_item', itemId: 8, payload: {quantity: 4}});
    });

    test('and the snapshot takes each answer as it comes, so a drain cut short still shows the landed line', async () => {
        enqueueOp(42, {type: 'add_item', tempId: 'tmp_b', payload: {sku: 'B2', quantity: 1}});
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
        const withB2 = {...ORDER, items: [...ORDER.items, {id: 88, sku: 'B2', price: '5.00', quantity: 1, line_total: '5.00'}]};
        orderService.rawAddOrderItem.mockResolvedValue(OK(withB2));
        orderService.rawUpdateOrder.mockResolvedValue(NET_FAIL);

        const result = await syncOrder(42, {userWarehouses: []});

        expect(result.aborted).toBe(true);
        expect(getSnapshot(42).items.map((item) => item.id)).toEqual([7, 88]);
        expect(landedEdit(42, {type: 'remove_item', itemId: 'tmp_b'})).toEqual({type: 'remove_item', itemId: 88});
    });

    test('but not an answer another write to the order overlapped, which may be the older of the two', async () => {
        // orderService flags a write's answer `overlapped` when another write
        // to the order was sent or answered while it was out: a live edit's
        // answer, newer and already saved, may be what it would replace.
        enqueueOp(42, {type: 'add_item', tempId: 'tmp_b', payload: {sku: 'B2', quantity: 1}});
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
        const withB2 = {...ORDER, items: [...ORDER.items, {id: 88, sku: 'B2', price: '5.00', quantity: 1, line_total: '5.00'}]};
        orderService.rawAddOrderItem.mockResolvedValue({...OK(withB2), overlapped: true});
        orderService.rawUpdateOrder.mockResolvedValue(NET_FAIL);

        const result = await syncOrder(42, {userWarehouses: []});

        expect(result).toMatchObject({aborted: true, synced: 1});
        expect(getSnapshot(42)).toEqual(ORDER);
        expect(getOps(42)).toEqual([expect.objectContaining({type: 'update_order'})]);
    });

    test('an edit of the line waits while its add is sent, and resumes once the answer is booked', async () => {
        enqueueOp(42, {type: 'add_item', tempId: 'tmp_b', payload: {sku: 'B2', quantity: 1}});
        const withB2 = {...ORDER, items: [...ORDER.items, {id: 88, sku: 'B2', price: '5.00', quantity: 1, line_total: '5.00'}]};
        let answerAdd;
        orderService.rawAddOrderItem.mockReturnValue(new Promise((resolve) => { answerAdd = resolve; }));
        orderService.getOrder.mockResolvedValue(OK(withB2));

        const drain = syncOrder(42, {userWarehouses: []});
        await flushMicrotasks();
        let seen = null;
        whenSent('tmp_b').then(() => {
            seen = {ops: getOps(42), edit: landedEdit(42, {type: 'remove_item', itemId: 'tmp_b'})};
        });
        await flushMicrotasks();
        expect(seen).toBeNull();

        answerAdd(OK(withB2));
        await drain;
        await flushMicrotasks();

        expect(seen).toEqual({ops: [], edit: {type: 'remove_item', itemId: 88}});
    });
});

test('a replica miss still resolves through the self-heal echo', async () => {
    enqueueOp(42, {type: 'add_item_barcode', tempId: 'tmp_a', barcode: 'NEW', quantity: 1});
    searchProduct.mockResolvedValue(CATALOG_MISS);
    fetchStock.mockResolvedValue(OK({results: [{
        sku: 'NEW', status: 'ok',
        stock: [{warehouse: 'W1', warehouse_name: 'Mine', quantity: 2}],
        product: {sku: 'S-NEW', sku_name: 'Discovered', article: 'A-NEW', price: 7},
    }]}));
    orderService.rawAddOrderItem.mockResolvedValue(OK(ORDER));

    const result = await syncOrder(42, {userWarehouses: [{code: 'W1'}]});

    expect(orderService.rawAddOrderItem).toHaveBeenCalledWith(42, expect.objectContaining({
        sku: 'S-NEW', sku_name: 'Discovered',
    }));
    expect(result.synced).toBe(1);
});

describe('terminal answers leave the drain but stay in front of the consultant', () => {
    test('not found by both halves of a reachable service', async () => {
        enqueueOp(42, {type: 'add_item_barcode', tempId: 'tmp_a', barcode: 'nope', quantity: 1});
        searchProduct.mockResolvedValue(CATALOG_MISS);
        fetchStock.mockResolvedValue(OK({results: [{sku: 'nope', status: 'not_found', stock: []}]}));

        const result = await syncOrder(42, {userWarehouses: []});

        // syncOrder's return shape (also relied on by UserDashboard.js) has
        // always been a `failures` array, never a `failed` count.
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0]).toMatchObject({reason: 'not_found'});
        expect(result.aborted).toBe(false);
        expect(getOps(42)).toHaveLength(0);
        expect(getAttention(42)).toEqual([expect.objectContaining({
            reason: 'not_found',
            product: 'nope',
            op: expect.objectContaining({barcode: 'nope', quantity: 1}),
        })]);
    });

    test('a catalog hit with no stock in any warehouse', async () => {
        queueBarcode();
        searchProduct.mockResolvedValue(CATALOG_HIT);
        fetchStock.mockResolvedValue(stockAnswer('ok'));

        const result = await syncOrder(42, {userWarehouses: [{code: 'W1'}]});

        expect(result.failures).toHaveLength(1);
        expect(getAttention(42)[0]).toMatchObject({reason: 'no_stock', product: 'Thing'});
        expect(orderService.rawAddOrderItem).not.toHaveBeenCalled();
    });

    test('a 4xx from the order endpoint parks the line and the drain continues; network failure aborts', async () => {
        enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 5}});
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
        orderService.rawUpdateOrderItem.mockResolvedValue(HTTP_FAIL);
        orderService.rawUpdateOrder.mockResolvedValue(NET_FAIL);

        const result = await syncOrder(42, {userWarehouses: []});

        expect(result.aborted).toBe(true);
        expect(result.failures).toHaveLength(1); // the HTTP failure
        expect(getOps(42)).toHaveLength(1);      // network-failed op stays queued
        expect(getOps(42)[0].type).toBe('update_order');
        expect(getAttention(42)).toEqual([expect.objectContaining({
            reason: 'rejected',
            detail: 'no stock',
            product: 'Pan', // named from the snapshot, which the line may not outlive
            op: expect.objectContaining({type: 'update_item', itemId: 7}),
        })]);
    });
});

describe('retryable answers keep the op queued and count an attempt', () => {
    test('stock unavailable (1C unreachable) retains the op', async () => {
        setNow(T0);
        queueBarcode();
        searchProduct.mockResolvedValue(CATALOG_HIT);
        fetchStock.mockResolvedValue(stockAnswer('unavailable'));

        const result = await syncOrder(42, {userWarehouses: [{code: 'W1'}]});

        expect(result).toMatchObject({aborted: false, failures: [], synced: 0, pending: 1});
        expect(getOps(42)).toEqual([expect.objectContaining({
            barcode: '4870001',
            attempts: 1,
            nextAttemptAt: T0 + RETRY_DELAYS_MS[0],
            lastReason: 'unavailable',
        })]);
        expect(getAttention(42)).toEqual([]);
        expect(orderService.rawAddOrderItem).not.toHaveBeenCalled();
        expect(isOffline()).toBe(false); // the server answered — this is not offline
    });

    test('stock unavailable for a replica miss is not a not-found verdict', async () => {
        queueBarcode();
        searchProduct.mockResolvedValue(CATALOG_MISS);
        fetchStock.mockResolvedValue(stockAnswer('unavailable'));

        await syncOrder(42, {userWarehouses: []});

        expect(getOps(42)[0]).toMatchObject({attempts: 1, lastReason: 'unavailable'});
        expect(getAttention(42)).toEqual([]);
    });

    test('no_lookup_key retains the op', async () => {
        queueBarcode();
        searchProduct.mockResolvedValue(CATALOG_HIT);
        fetchStock.mockResolvedValue(stockAnswer('no_lookup_key'));

        await syncOrder(42, {userWarehouses: [{code: 'W1'}]});

        expect(getOps(42)[0]).toMatchObject({attempts: 1, lastReason: 'no_lookup_key'});
    });

    test('a 404 from the stock leg retains the op', async () => {
        // The deploy-window case: on DigitalOcean the static frontend and the
        // buildpack backend ship separately. If the frontend lands first, the new
        // client posts to a /product/stock/ route the backend does not have yet.
        // The stock endpoint's contract is ALWAYS 200, so a 404 is not an answer
        // about this barcode — dropping the op here would destroy a queued sale
        // line for a product that exists. The server did answer, though, so the
        // attempt counts and the app is not marked offline.
        queueBarcode({quantity: 1});
        searchProduct.mockResolvedValue(CATALOG_HIT);
        fetchStock.mockResolvedValue({success: false, error: 'Not Found', code: null, status: 404});

        const result = await syncOrder(42, {userWarehouses: [{code: 'W1'}]});

        expect(result.failures).toHaveLength(0);
        expect(getOps(42)).toHaveLength(1); // retained, not dropped
        expect(getOps(42)[0]).toMatchObject({attempts: 1, lastReason: 'server_error'});
        expect(orderService.rawAddOrderItem).not.toHaveBeenCalled();
    });

    test('a 500 from the stock leg retains the op', async () => {
        queueBarcode({quantity: 1});
        searchProduct.mockResolvedValue(CATALOG_HIT);
        fetchStock.mockResolvedValue(SERVER_FAIL);

        await syncOrder(42, {userWarehouses: [{code: 'W1'}]});

        expect(getOps(42)).toHaveLength(1);
        expect(getOps(42)[0]).toMatchObject({attempts: 1, lastReason: 'server_error'});
        expect(orderService.rawAddOrderItem).not.toHaveBeenCalled();
    });

    test('a 5xx from the order endpoint retains the op and later ops still drain', async () => {
        enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 5}});
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
        orderService.rawUpdateOrderItem.mockResolvedValue(SERVER_FAIL);
        orderService.rawUpdateOrder.mockResolvedValue(OK(ORDER));

        const result = await syncOrder(42, {userWarehouses: []});

        expect(result).toMatchObject({aborted: false, failures: [], synced: 1, pending: 1});
        expect(getOps(42)).toEqual([expect.objectContaining({type: 'update_item', attempts: 1})]);
        expect(orderService.rawUpdateOrder).toHaveBeenCalledWith(42, {notes: 'x'});
    });

    test('a 429 is retryable, not a rejection', async () => {
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
        orderService.rawUpdateOrder.mockResolvedValue({success: false, error: 'slow down', code: 'RATE_LIMITED', status: 429});

        const result = await syncOrder(42, {userWarehouses: []});

        expect(result.failures).toHaveLength(0);
        expect(getOps(42)[0]).toMatchObject({attempts: 1, lastReason: 'server_error'});
    });

    test('each answered attempt waits longer than the one before', async () => {
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
        orderService.rawUpdateOrder.mockResolvedValue(SERVER_FAIL);

        let now = T0;
        const waits = [];
        for (let i = 0; i < 3; i += 1) {
            setNow(now);
            // eslint-disable-next-line no-await-in-loop
            await syncOrder(42, {userWarehouses: []});
            const {nextAttemptAt} = getOps(42)[0];
            waits.push(nextAttemptAt - now);
            now = nextAttemptAt;
        }

        expect(waits).toEqual(RETRY_DELAYS_MS.slice(0, 3));
        expect(waits[0]).toBeLessThan(waits[1]);
        expect(waits[1]).toBeLessThan(waits[2]);
    });
});

describe('transport failures', () => {
    test('a stock-leg transport failure with a real catalog hit retains the op without counting', async () => {
        // Before the catalog/stock split this combination could not happen: one
        // HTTP call carried both identity and stock, so a transport failure
        // failed the whole thing and retained the op. Now the catalog leg can
        // succeed while the stock leg alone drops on the network — that must
        // still retain, not silently drop a queued sale line.
        queueBarcode({quantity: 1});
        searchProduct.mockResolvedValue(CATALOG_HIT);
        fetchStock.mockResolvedValue(NET_FAIL);

        const result = await syncOrder(42, {userWarehouses: [{code: 'W1'}]});

        expect(result.aborted).toBe(true);
        expect(getOps(42)).toHaveLength(1); // retained, not dropped
        expect(getOps(42)[0].attempts).toBeUndefined(); // offline costs no attempt
        expect(getOps(42)[0].nextAttemptAt).toBeUndefined(); // and no backoff
        expect(orderService.rawAddOrderItem).not.toHaveBeenCalled();
    });

    test('a transport failure on the catalog leg with no stock-echoed identity retains the op', async () => {
        enqueueOp(42, {type: 'add_item_barcode', tempId: 'tmp_a', barcode: 'X', quantity: 1});
        searchProduct.mockResolvedValue(NET_FAIL);
        fetchStock.mockResolvedValue(OK({results: [{sku: 'X', status: 'not_found', stock: []}]}));

        const result = await syncOrder(42, {userWarehouses: []});

        expect(result.aborted).toBe(true);
        expect(getOps(42)).toHaveLength(1); // retained, not dropped
        expect(getAttention(42)).toEqual([]); // and not a not-found verdict either
        expect(orderService.rawAddOrderItem).not.toHaveBeenCalled();
    });

    test('a transport failure on the stock leg with no catalog identity retains the op', async () => {
        enqueueOp(42, {type: 'add_item_barcode', tempId: 'tmp_a', barcode: 'Y', quantity: 1});
        searchProduct.mockResolvedValue(CATALOG_MISS);
        fetchStock.mockResolvedValue(NET_FAIL);

        const result = await syncOrder(42, {userWarehouses: []});

        expect(result.aborted).toBe(true);
        expect(getOps(42)).toHaveLength(1); // retained, not dropped
        expect(orderService.rawAddOrderItem).not.toHaveBeenCalled();
    });

    test('an op that already has answered attempts keeps its count across an offline spell', async () => {
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}, attempts: 2});
        orderService.rawUpdateOrder.mockResolvedValue(NET_FAIL);

        await syncOrder(42, {userWarehouses: []});

        expect(getOps(42)[0].attempts).toBe(2);
    });
});

describe('the attempt cap', () => {
    test('moves a line that never gets an answer to needs-attention instead of deleting it', async () => {
        queueBarcode();
        searchProduct.mockResolvedValue(CATALOG_HIT);
        fetchStock.mockResolvedValue(stockAnswer('unavailable'));

        let now = T0;
        let last;
        const queuedAndParked = [];
        for (let i = 0; i < MAX_REPLAY_ATTEMPTS; i += 1) {
            setNow(now);
            // eslint-disable-next-line no-await-in-loop
            last = await syncOrder(42, {userWarehouses: [{code: 'W1'}]});
            queuedAndParked.push([getOps(42).length, getAttention(42).length]);
            now += 60 * 60 * 1000; // well past any backoff
        }

        // Queued after every attempt but the last, then parked — never gone.
        expect(queuedAndParked).toEqual([...Array(MAX_REPLAY_ATTEMPTS - 1).fill([1, 0]), [0, 1]]);
        expect(fetchStock).toHaveBeenCalledTimes(MAX_REPLAY_ATTEMPTS);
        expect(getOps(42)).toEqual([]);
        expect(getAttention(42)).toEqual([expect.objectContaining({
            reason: 'unavailable',
            attempts: MAX_REPLAY_ATTEMPTS,
            product: 'Thing',
            op: expect.objectContaining({barcode: '4870001', quantity: 2}),
        })]);
        expect(last.failures).toEqual([expect.objectContaining({reason: 'unavailable'})]);
    });
});

describe('backoff and ordering', () => {
    test('a not-yet-due op is skipped while later ops drain, and replayed once due', async () => {
        setNow(T0);
        enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 5}});
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
        orderService.rawUpdateOrderItem.mockResolvedValueOnce(SERVER_FAIL);
        orderService.rawUpdateOrder.mockResolvedValue(OK(ORDER));
        await syncOrder(42, {userWarehouses: []}); // the item edit backs off; the notes go through
        expect(orderService.rawUpdateOrder).toHaveBeenCalledTimes(1);

        enqueueOp(42, {type: 'update_order', payload: {notes: 'y'}});
        setNow(T0 + RETRY_DELAYS_MS[0] - 1);
        const early = await syncOrder(42, {userWarehouses: []});

        expect(orderService.rawUpdateOrderItem).toHaveBeenCalledTimes(1); // not hammered
        expect(orderService.rawUpdateOrder).toHaveBeenLastCalledWith(42, {notes: 'y'}); // not blocked
        expect(early.synced).toBe(1);
        expect(getOps(42).map((op) => op.type)).toEqual(['update_item']);

        orderService.rawUpdateOrderItem.mockResolvedValue(OK(ORDER));
        setNow(T0 + RETRY_DELAYS_MS[0]);
        await syncOrder(42, {userWarehouses: []});

        expect(orderService.rawUpdateOrderItem).toHaveBeenCalledTimes(2);
        expect(getOps(42)).toEqual([]);
    });

    test('a held-back edit keeps later edits of the same line behind it', async () => {
        // Two edits of one line are last-write-wins: letting the second overtake
        // a retrying first would have the first land later and undo it.
        enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 5}});
        enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 3}});
        enqueueOp(42, {type: 'remove_item', itemId: 7});
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
        orderService.rawUpdateOrderItem.mockResolvedValue(SERVER_FAIL);
        orderService.rawUpdateOrder.mockResolvedValue(OK(ORDER));

        await syncOrder(42, {userWarehouses: []});

        expect(orderService.rawUpdateOrderItem).toHaveBeenCalledTimes(1);
        expect(orderService.rawUpdateOrderItem).toHaveBeenCalledWith(42, 7, {quantity: 5});
        expect(orderService.rawRemoveOrderItem).not.toHaveBeenCalled();
        expect(orderService.rawUpdateOrder).toHaveBeenCalledTimes(1);
        expect(getOps(42).map((op) => [op.type, op.attempts])).toEqual([
            ['update_item', 1], ['update_item', undefined], ['remove_item', undefined],
        ]);
    });

    test('ops queued while an op is in flight are each replayed once, none lost', async () => {
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
        let release;
        orderService.rawUpdateOrder.mockReturnValue(new Promise((resolve) => { release = resolve; }));
        orderService.rawUpdateOrderItem.mockResolvedValue(OK(ORDER));
        orderService.rawRemoveOrderItem.mockResolvedValue(OK(ORDER));

        const syncPromise = syncOrder(42, {userWarehouses: []});
        await flushMicrotasks();
        // The network dropped for another edit meanwhile: these are queued
        // by orderService's offline fallback, with no id yet.
        enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 4}});
        enqueueOp(42, {type: 'remove_item', itemId: 9});
        release(OK(ORDER));
        const result = await syncPromise;

        expect(orderService.rawUpdateOrderItem).toHaveBeenCalledTimes(1);
        expect(orderService.rawRemoveOrderItem).toHaveBeenCalledTimes(1);
        expect(result.synced).toBe(3);
        expect(getOps(42)).toEqual([]);
    });

    test('an order edit queued while the drain has the one before it on the wire goes out after it, not into it', async () => {
        // Folded into the op in flight, the new fields would leave the queue
        // with that op's answer, never sent.
        enqueueOp(42, {type: 'update_order', payload: {notes: 'A'}});
        let release;
        orderService.rawUpdateOrder
            .mockReturnValueOnce(new Promise((resolve) => { release = resolve; }))
            .mockResolvedValue(OK(ORDER));

        const drain = syncOrder(42, {userWarehouses: []});
        await flushMicrotasks();
        expect(orderService.rawUpdateOrder).toHaveBeenCalledTimes(1);
        enqueueOp(42, {type: 'update_order', payload: {delivery_address: 'Rustaveli 1'}});
        release(OK(ORDER));
        const result = await drain;

        expect(orderService.rawUpdateOrder.mock.calls).toEqual([
            [42, {notes: 'A'}], [42, {delivery_address: 'Rustaveli 1'}],
        ]);
        expect(result.synced).toBe(2);
        expect(getOps(42)).toEqual([]);
    });

    test('a line the consultant removed while its replay was in flight is not reported', async () => {
        queueBarcode();
        let answerStock;
        searchProduct.mockResolvedValue(CATALOG_MISS);
        fetchStock.mockReturnValue(new Promise((resolve) => { answerStock = resolve; }));

        const syncPromise = syncOrder(42, {userWarehouses: []});
        await flushMicrotasks();
        enqueueOp(42, {type: 'remove_item', itemId: 'tmp_a'}); // cancels the queued add
        answerStock(stockAnswer('not_found'));
        const result = await syncPromise;

        expect(result.failures).toEqual([]);
        expect(getAttention(42)).toEqual([]);
    });

    test('with nothing due and the app online, a sync sends no request at all', async () => {
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}, attempts: 1, nextAttemptAt: Date.now() + 60000});

        const result = await syncOrder(42, {userWarehouses: []});

        expect(orderService.getOrder).not.toHaveBeenCalled();
        expect(orderService.rawUpdateOrder).not.toHaveBeenCalled();
        expect(result).toMatchObject({synced: 0, failures: [], aborted: false, order: null, pending: 1});
    });

    test('while offline the probe still runs as the connectivity check, even with nothing due', async () => {
        markOffline();
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}, attempts: 1, nextAttemptAt: Date.now() + 60000});

        await syncOrder(42, {userWarehouses: []});

        expect(orderService.getOrder).toHaveBeenCalledTimes(1);
        expect(orderService.rawUpdateOrder).not.toHaveBeenCalled();
    });

    test('an op that is due but held behind a backing-off one sends no request', async () => {
        enqueueOp(42, {
            type: 'update_item', itemId: 7, payload: {quantity: 5}, attempts: 4, nextAttemptAt: Date.now() + 60000,
        });
        enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 6}});

        const result = await syncOrder(42, {userWarehouses: []});

        expect(orderService.getOrder).not.toHaveBeenCalled();
        expect(orderService.rawUpdateOrderItem).not.toHaveBeenCalled();
        expect(result).toMatchObject({synced: 0, order: null, pending: 2});
    });

    test('a drain that applied nothing answers with the order as it is now, not as the probe found it', async () => {
        // The replay can wait out the stock call's 25 s deadline; a live edit
        // made meanwhile must not be reverted by the order read before it.
        queueBarcode();
        searchProduct.mockResolvedValue(CATALOG_HIT);
        fetchStock.mockResolvedValue(stockAnswer('unavailable'));
        const afterLiveEdit = {...ORDER, items: [{...ORDER.items[0], quantity: 5, line_total: '50.00'}]};
        orderService.getOrder.mockResolvedValueOnce(OK(ORDER)).mockResolvedValue(OK(afterLiveEdit));

        const result = await syncOrder(42, {userWarehouses: [{code: 'W1'}]});

        expect(result.synced).toBe(0);
        expect(result.order.items[0]).toMatchObject({id: 7, quantity: 5});
        expect(getSnapshot(42).items[0]).toMatchObject({id: 7, quantity: 5});
    });

    test('a partial drain keeps the still-queued lines on the refreshed order', async () => {
        queueBarcode();
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
        searchProduct.mockResolvedValue(CATALOG_HIT);
        fetchStock.mockResolvedValue(stockAnswer('unavailable'));
        orderService.rawUpdateOrder.mockResolvedValue(OK(ORDER));

        const result = await syncOrder(42, {userWarehouses: [{code: 'W1'}]});

        const placeholder = expect.objectContaining({id: 'tmp_a', _pending: true, _barcodeOnly: true});
        expect(result.order.items).toEqual([expect.objectContaining({id: 7}), placeholder]);
        expect(getSnapshot(42).items).toEqual([expect.objectContaining({id: 7}), placeholder]);
    });

    test('a refetch that already shows the still-queued lines does not show them twice', async () => {
        // The real orderService.getOrder answers with the queue laid over the
        // server's order already.
        queueBarcode();
        searchProduct.mockResolvedValue(CATALOG_HIT);
        fetchStock.mockResolvedValue(stockAnswer('unavailable'));
        orderService.getOrder.mockImplementation(async () => OK(applyOpToSnapshot(ORDER, getOps(42)[0])));

        const result = await syncOrder(42, {userWarehouses: [{code: 'W1'}]});

        expect(result.order.items.map((item) => item.id)).toEqual([7, 'tmp_a']);
        expect(getSnapshot(42).items.map((item) => item.id)).toEqual([7, 'tmp_a']);
    });
});

// orderService.getOrder answers `stale: true` when a write to the order was
// sent or answered while the read was out: the server may have read the order
// before that write committed, and the write's own answer, which is newer,
// is already on screen.
describe('a refetch that a write overlapped', () => {
    const NOTED = {...ORDER, notes: 'x'};
    const EDITED = {...NOTED, items: [{...ORDER.items[0], quantity: 5, line_total: '50.00'}]};
    const stale = (data) => ({...OK(data), stale: true});

    beforeEach(() => {
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
        orderService.rawUpdateOrder.mockResolvedValue(OK(NOTED));
    });

    test('is read again, and the second answer is the one saved and handed back', async () => {
        orderService.getOrder
            .mockResolvedValueOnce(OK(ORDER)) // the opening read
            .mockResolvedValueOnce(stale(NOTED)) // read before the live edit committed
            .mockResolvedValueOnce(OK(EDITED));

        const result = await syncOrder(42, {userWarehouses: []});

        expect(orderService.getOrder).toHaveBeenCalledTimes(3);
        expect(result).toMatchObject({synced: 1, aborted: false, order: EDITED});
        expect(getSnapshot(42)).toEqual(EDITED);
    });

    test('and when that read is overlapped too, no order is handed back or saved', async () => {
        // The dashboard keeps what it shows: the live edit's own answer.
        orderService.getOrder
            .mockResolvedValueOnce(OK(ORDER))
            .mockImplementationOnce(async () => {
                saveSnapshot(42, EDITED); // the live edit's answer, landing while the read is out
                return stale(NOTED);
            })
            .mockResolvedValueOnce(stale(NOTED));

        const result = await syncOrder(42, {userWarehouses: []});

        expect(orderService.getOrder).toHaveBeenCalledTimes(3);
        expect(result).toMatchObject({synced: 1, aborted: false, failures: [], order: null, pending: 0});
        expect(getSnapshot(42)).toEqual(EDITED);
        expect(isOffline()).toBe(false); // the server answered all the same
    });

    test('an overlapped opening read is not taken as the result either, when it is all the drain read', async () => {
        // Offline with nothing due, the probe runs only as the connectivity check.
        markOffline();
        const [{id}] = assignOpIds(42);
        updateOp(42, id, {attempts: 1, nextAttemptAt: Date.now() + 60000});
        orderService.getOrder.mockResolvedValueOnce(stale(ORDER)).mockResolvedValueOnce(OK(EDITED));

        const result = await syncOrder(42, {userWarehouses: []});

        expect(orderService.rawUpdateOrder).not.toHaveBeenCalled();
        expect(orderService.getOrder).toHaveBeenCalledTimes(2);
        // The second read, with the op still backing off laid over it.
        expect(result.order).toEqual(applyOpToSnapshot(EDITED, getOps(42)[0]));
        expect(result.order.items[0].quantity).toBe(5);
        expect(getSnapshot(42)).toEqual(result.order);
        expect(isOffline()).toBe(false);
    });

    test('a refetch nothing overlapped is saved and handed back as it came, with no second read', async () => {
        orderService.getOrder.mockResolvedValueOnce(OK(ORDER)).mockResolvedValueOnce(OK(NOTED));

        const result = await syncOrder(42, {userWarehouses: []});

        expect(orderService.getOrder).toHaveBeenCalledTimes(2);
        expect(result.order).toEqual(NOTED);
        expect(getSnapshot(42)).toEqual(NOTED);
    });
});

describe('changes to the lines keep their order', () => {
    const BAD_GATEWAY = {success: false, error: 'Bad Gateway', code: null, status: 502};

    test('a line edit never overtakes a held add: a gift split does not shrink the paid line first', async () => {
        // giftSplit.js queues the growing side first, so a failure in between
        // leaves a surplus rather than silently dropping a unit.
        enqueueOp(42, {
            type: 'add_item', tempId: 'tmp_g', payload: {sku: 'A1', quantity: 1, is_gift: true, warehouse_code: 'W1'},
        });
        enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 2}});
        orderService.rawAddOrderItem.mockResolvedValue(BAD_GATEWAY);
        orderService.rawUpdateOrderItem.mockResolvedValue(OK(ORDER));

        await syncOrder(42, {userWarehouses: []});

        expect(orderService.rawUpdateOrderItem).not.toHaveBeenCalled();
        expect(getOps(42).map((op) => [op.type, op.attempts])).toEqual([['add_item', 1], ['update_item', undefined]]);
    });

    test('nor a held edit of the other line of a gift pair', async () => {
        enqueueOp(42, {type: 'update_item', itemId: 8, payload: {quantity: 2}}); // gift side grows
        enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 1}}); // paid side shrinks
        orderService.rawUpdateOrderItem.mockResolvedValueOnce(SERVER_FAIL).mockResolvedValue(OK(ORDER));

        await syncOrder(42, {userWarehouses: []});

        expect(orderService.rawUpdateOrderItem.mock.calls).toEqual([[42, 8, {quantity: 2}]]);
    });

    test('an add never overtakes a held edit or remove: the server merges an add into a matching line', async () => {
        // Landing first, the re-scanned unit would join line 7 and then be
        // deleted with it when the held remove goes through.
        enqueueOp(42, {type: 'remove_item', itemId: 7});
        enqueueOp(42, {type: 'add_item', tempId: 'tmp_b', payload: {sku: 'A1', quantity: 1, warehouse_code: 'W1'}});
        orderService.rawRemoveOrderItem.mockResolvedValue(SERVER_FAIL);
        orderService.rawAddOrderItem.mockResolvedValue(OK(ORDER));

        await syncOrder(42, {userWarehouses: []});

        expect(orderService.rawAddOrderItem).not.toHaveBeenCalled();
        expect(getOps(42).map((op) => op.type)).toEqual(['remove_item', 'add_item']);
    });

    test('an add still passes a held add, and order details pass held line changes', async () => {
        queueBarcode();
        enqueueOp(42, {type: 'add_item', tempId: 'tmp_b', payload: {sku: 'S1', quantity: 1}});
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
        searchProduct.mockResolvedValue(CATALOG_HIT);
        fetchStock.mockResolvedValue(stockAnswer('unavailable'));
        orderService.rawAddOrderItem.mockResolvedValue(OK(ORDER));
        orderService.rawUpdateOrder.mockResolvedValue(OK(ORDER));

        const result = await syncOrder(42, {userWarehouses: [{code: 'W1'}]});

        expect(orderService.rawAddOrderItem).toHaveBeenCalledWith(42, {sku: 'S1', quantity: 1});
        expect(orderService.rawUpdateOrder).toHaveBeenCalledWith(42, {notes: 'x'});
        expect(result.synced).toBe(2);
        expect(getOps(42)).toEqual([expect.objectContaining({type: 'add_item_barcode', attempts: 1})]);
    });

    test('a parked edit holds later edits of the order back, so Retry now cannot land it over a newer one', async () => {
        enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 5}, attempts: MAX_REPLAY_ATTEMPTS - 1});
        enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 6}});
        orderService.rawUpdateOrderItem.mockResolvedValueOnce(SERVER_FAIL).mockResolvedValue(OK(ORDER));

        await syncOrder(42, {userWarehouses: []});

        expect(getAttention(42)).toHaveLength(1); // the cap ran out on the 5
        expect(orderService.rawUpdateOrderItem).toHaveBeenCalledTimes(1);
        expect(getOps(42)).toEqual([expect.objectContaining({payload: {quantity: 6}})]);

        retryAttention(42, getAttention(42)[0].op.id);
        await syncOrder(42, {userWarehouses: []});

        const sent = orderService.rawUpdateOrderItem.mock.calls.map(([, , payload]) => payload.quantity);
        expect(sent).toEqual([5, 5, 6]); // the newest edit lands last
        expect(getOps(42)).toEqual([]);
    });

    test('a parked scan holds back later line edits until it is discarded', async () => {
        enqueueOp(42, {type: 'add_item_barcode', tempId: 'tmp_a', barcode: 'nope', quantity: 1});
        enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 5}});
        searchProduct.mockResolvedValue(CATALOG_MISS);
        fetchStock.mockResolvedValue(stockAnswer('not_found'));
        orderService.rawUpdateOrderItem.mockResolvedValue(OK(ORDER));

        await syncOrder(42, {userWarehouses: []});

        expect(getAttention(42)).toEqual([expect.objectContaining({reason: 'not_found'})]);
        expect(orderService.rawUpdateOrderItem).not.toHaveBeenCalled();

        discardAttention(42, getAttention(42)[0].op.id);
        await syncOrder(42, {userWarehouses: []});

        expect(orderService.rawUpdateOrderItem).toHaveBeenCalledWith(42, 7, {quantity: 5});
    });
});

test('a remove whose line is already gone is done, not rejected', async () => {
    // The DELETE can commit on a request whose answer never arrived, which
    // is how the remove got queued in the first place.
    enqueueOp(42, {type: 'remove_item', itemId: 7});
    orderService.rawRemoveOrderItem.mockResolvedValue({success: false, error: 'Item not found.', code: null, status: 404});

    const result = await syncOrder(42, {userWarehouses: []});

    expect(result).toMatchObject({synced: 1, failures: []});
    expect(getAttention(42)).toEqual([]);
    expect(getOps(42)).toEqual([]);
});

test('but a remove of a placeholder id the server never issued is not taken as done', async () => {
    // Its 404 says only that the id was never the server's: the line the
    // placeholder became is still on the order.
    enqueueOp(42, {type: 'remove_item', itemId: 'tmp_x'});
    orderService.rawRemoveOrderItem.mockResolvedValue({success: false, error: 'Item not found.', code: null, status: 404});

    const result = await syncOrder(42, {userWarehouses: []});

    expect(result).toMatchObject({synced: 0, failures: [expect.objectContaining({reason: 'rejected'})]});
    expect(getAttention(42)).toEqual([expect.objectContaining({
        reason: 'rejected', op: expect.objectContaining({type: 'remove_item', itemId: 'tmp_x'}),
    })]);
});

describe('queues written before this contract', () => {
    const writeLegacyQueue = (ops) => localStorage.setItem(
        'barcode-scanner.offlineOrders.99',
        JSON.stringify({42: {snapshot: ORDER, ops}}),
    );

    test('old-format ops (no id, no attempt count) still replay', async () => {
        writeLegacyQueue([
            {type: 'update_item', itemId: 7, payload: {quantity: 5}},
            {type: 'add_item_barcode', tempId: 'tmp_a', barcode: '4870001', quantity: 2},
        ]);
        orderService.rawUpdateOrderItem.mockResolvedValue(OK(ORDER));
        orderService.rawAddOrderItem.mockResolvedValue(OK(ORDER));
        searchProduct.mockResolvedValue(CATALOG_HIT);
        fetchStock.mockResolvedValue(STOCK_IN_W1);

        const result = await syncOrder(42, {userWarehouses: [{code: 'W1'}]});

        expect(result).toMatchObject({synced: 2, failures: [], aborted: false});
        expect(getOps(42)).toEqual([]);
    });

    test('an old-format op starts counting from zero', async () => {
        writeLegacyQueue([{type: 'add_item_barcode', tempId: 'tmp_a', barcode: '4870001', quantity: 2}]);
        searchProduct.mockResolvedValue(CATALOG_HIT);
        fetchStock.mockResolvedValue(stockAnswer('unavailable'));

        await syncOrder(42, {userWarehouses: [{code: 'W1'}]});

        expect(getOps(42)).toEqual([expect.objectContaining({barcode: '4870001', attempts: 1})]);
    });
});

test('Retry now: a parked line goes back into the drain and replays', async () => {
    queueBarcode();
    const [{id}] = assignOpIds(42);
    parkOp(42, id, {reason: 'unavailable', attempts: MAX_REPLAY_ATTEMPTS, product: 'Thing'});
    searchProduct.mockResolvedValue(CATALOG_HIT);
    fetchStock.mockResolvedValue(STOCK_IN_W1);
    orderService.rawAddOrderItem.mockResolvedValue(OK(ORDER));

    retryAttention(42, id);
    const result = await syncOrder(42, {userWarehouses: [{code: 'W1'}]});

    expect(result.synced).toBe(1);
    expect(getAttention(42)).toEqual([]);
    expect(getOps(42)).toEqual([]);
});

describe('an order the server answers but will not read out (500, 403, ...)', () => {
    const PROBE_FAIL = {success: false, error: 'server error', code: null, status: 500};

    test('sends nothing, and charges each op it held up the attempt it would have made', async () => {
        // Without the charge, a failure that lasts would be probed every tick
        // for good, and its lines would never reach the consultant.
        setNow(T0);
        enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 5}});
        enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 6}}); // behind the first
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
        orderService.getOrder.mockResolvedValue(PROBE_FAIL);

        const result = await syncOrder(42, {userWarehouses: []});

        expect(result).toMatchObject({aborted: true, synced: 0, failures: []});
        expect(orderService.rawUpdateOrderItem).not.toHaveBeenCalled();
        expect(orderService.rawUpdateOrder).not.toHaveBeenCalled();
        expect(getOps(42).map((op) => [op.type, op.attempts, op.nextAttemptAt, op.lastReason])).toEqual([
            ['update_item', 1, T0 + RETRY_DELAYS_MS[0], 'server_error'],
            ['update_item', undefined, undefined, undefined],
            ['update_order', 1, T0 + RETRY_DELAYS_MS[0], 'server_error'],
        ]);
    });

    test('so one that never recovers ends up in front of the consultant', async () => {
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}, attempts: MAX_REPLAY_ATTEMPTS - 1});
        orderService.getOrder.mockResolvedValue(PROBE_FAIL);

        const result = await syncOrder(42, {userWarehouses: []});

        expect(result.failures).toEqual([expect.objectContaining({reason: 'server_error', detail: 'server error'})]);
        expect(getAttention(42)).toHaveLength(1);
        expect(getOps(42)).toEqual([]);
    });
});

test('deleted order clears its queue', async () => {
    enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
    orderService.getOrder.mockResolvedValue({success: false, error: 'gone', code: null, status: 404});

    const result = await syncOrder(42, {userWarehouses: []});

    expect(getOps(42)).toHaveLength(0);
    expect(getSnapshot(42)).toBeNull();
    expect(result.failures).toHaveLength(1);
    expect(result.orderGone).toBe(true);
});

describe('startSyncLoop', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    test('while online, the loop picks an op up once its backoff runs out', async () => {
        jest.useFakeTimers('modern');
        jest.setSystemTime(T0);
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}, attempts: 1, nextAttemptAt: T0 + 15000});
        orderService.rawUpdateOrder.mockResolvedValue(OK(ORDER));
        const onSynced = jest.fn();
        const stop = startSyncLoop(() => ({userWarehouses: [], onSynced}));

        jest.advanceTimersByTime(10000); // still backing off
        await flushMicrotasks(50);
        expect(orderService.getOrder).not.toHaveBeenCalled();

        jest.advanceTimersByTime(10000); // now due
        await flushMicrotasks(50);
        expect(orderService.rawUpdateOrder).toHaveBeenCalledTimes(1);
        expect(getOps(42)).toEqual([]);
        expect(onSynced).toHaveBeenCalledWith('42', expect.objectContaining({synced: 1}));
        stop();
    });

    test('while online, the tick sends nothing for an op held behind one still backing off', async () => {
        jest.useFakeTimers('modern');
        jest.setSystemTime(T0);
        enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 5}, attempts: 4, nextAttemptAt: T0 + 5 * 60000});
        enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 6}});
        const onSynced = jest.fn();
        const stop = startSyncLoop(() => ({userWarehouses: [], onSynced}));

        jest.advanceTimersByTime(30000);
        await flushMicrotasks(50);

        expect(orderService.getOrder).not.toHaveBeenCalled();
        expect(onSynced).not.toHaveBeenCalled();
        stop();
    });

    test('a reconnect noticed mid-drain does not restart a drain that then fails at transport', async () => {
        // The probe answering flips the app online, which calls the loop's
        // reconnect listener while its own drain is still running.
        markOffline();
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
        let probes = 0;
        orderService.getOrder.mockImplementation(async () => {
            probes += 1;
            if (probes > 5) return NET_FAIL; // so a runaway loop ends and the test can report it
            markOnline(); // what orderService.getOrder's trackSuccess does
            return OK(ORDER);
        });
        orderService.rawUpdateOrder.mockResolvedValue(NET_FAIL);
        const stop = startSyncLoop(() => ({userWarehouses: [], onSynced: jest.fn()}));

        requestSync();
        await flushMicrotasks(200);

        expect(orderService.getOrder).toHaveBeenCalledTimes(1);
        expect(orderService.rawUpdateOrder).toHaveBeenCalledTimes(1);
        expect(isOffline()).toBe(true);
        stop();
    });

    test('an order the server will not read out does not hold back the orders after it', async () => {
        saveSnapshot(12, {...ORDER, id: 12});
        enqueueOp(12, {type: 'update_order', payload: {notes: 'x'}});
        enqueueOp(42, {type: 'update_order', payload: {notes: 'y'}});
        orderService.getOrder.mockImplementation(async (id) => (String(id) === '12'
            ? {success: false, error: 'server error', code: null, status: 500}
            : OK(ORDER)));
        orderService.rawUpdateOrder.mockResolvedValue(OK(ORDER));
        const stop = startSyncLoop(() => ({userWarehouses: [], onSynced: jest.fn()}));

        requestSync();
        await flushMicrotasks(50);

        expect(orderService.rawUpdateOrder.mock.calls).toEqual([['42', {notes: 'y'}]]);
        stop();
    });

    test('requestSync drains at once instead of waiting for the next tick', async () => {
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
        orderService.rawUpdateOrder.mockResolvedValue(OK(ORDER));
        const stop = startSyncLoop(() => ({userWarehouses: [], onSynced: jest.fn()}));

        requestSync();
        await flushMicrotasks(50);

        expect(orderService.rawUpdateOrder).toHaveBeenCalledTimes(1);
        stop();
        requestSync(); // no loop running: a no-op, not a crash
    });

    test('a sync requested mid-drain runs once the drain in flight finishes', async () => {
        // Order 43 has nothing queued when the first drain starts, so that
        // drain never looks at it; the Retry now that lands meanwhile must not
        // wait for the next tick.
        saveSnapshot(43, {...ORDER, id: 43});
        enqueueOp(43, {type: 'remove_item', itemId: 8});
        const [{id}] = assignOpIds(43);
        parkOp(43, id, {reason: 'rejected'});
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
        let release;
        orderService.rawUpdateOrder.mockReturnValue(new Promise((resolve) => { release = resolve; }));
        orderService.rawRemoveOrderItem.mockResolvedValue(OK(ORDER));
        const stop = startSyncLoop(() => ({userWarehouses: [], onSynced: jest.fn()}));

        requestSync();
        await flushMicrotasks(20);
        expect(orderService.rawUpdateOrder).toHaveBeenCalledTimes(1); // in flight

        retryAttention(43, id);
        requestSync();
        await flushMicrotasks(20);
        expect(orderService.rawRemoveOrderItem).not.toHaveBeenCalled();

        release(OK(ORDER));
        await flushMicrotasks(80);
        // The loop reads order ids back out of storage keys, so they arrive as strings.
        expect(orderService.rawRemoveOrderItem).toHaveBeenCalledWith('43', 8);
        stop();
    });

    test('a loop started while an earlier loop\'s drain is still out does not replay its op beside it', async () => {
        // The dashboard remounted — a company admin went to another page and
        // back — while its first mount's drain still waited on the server.
        // The op in flight is due and untried as far as the new loop can
        // tell; sent twice, an add would double its units.
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
        saveSnapshot(43, {...ORDER, id: 43});
        let release;
        orderService.rawUpdateOrder.mockReturnValue(new Promise((resolve) => { release = resolve; }));
        orderService.rawRemoveOrderItem.mockResolvedValue(OK(ORDER));
        const stopFirst = startSyncLoop(() => ({userWarehouses: [], onSynced: jest.fn()}));
        requestSync();
        await flushMicrotasks(20);
        expect(orderService.rawUpdateOrder).toHaveBeenCalledTimes(1);
        stopFirst(); // unmounted; its drain carries on

        const onSynced = jest.fn();
        const stopSecond = startSyncLoop(() => ({userWarehouses: [], onSynced}));
        enqueueOp(43, {type: 'remove_item', itemId: 8});
        requestSync();
        await flushMicrotasks(20);
        expect(orderService.rawUpdateOrder).toHaveBeenCalledTimes(1);
        expect(orderService.rawRemoveOrderItem).not.toHaveBeenCalled();

        // Once that drain ends, the sync asked of the new loop runs.
        release(OK(ORDER));
        await flushMicrotasks(80);
        expect(orderService.rawUpdateOrder).toHaveBeenCalledTimes(1);
        expect(orderService.rawRemoveOrderItem).toHaveBeenCalledWith('43', 8);
        expect(onSynced).toHaveBeenCalledWith('43', expect.objectContaining({synced: 1}));
        stopSecond();
    });

    test('that earlier drain hands what it synced to the loop running now', async () => {
        // The dashboard mounted now restored the order from the snapshot as it
        // stood mid-drain; the one that started the drain is gone.
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
        let release;
        orderService.rawUpdateOrder.mockReturnValue(new Promise((resolve) => { release = resolve; }));
        const first = jest.fn();
        const stopFirst = startSyncLoop(() => ({userWarehouses: [], onSynced: first}));
        requestSync();
        await flushMicrotasks(20);
        stopFirst();

        const second = jest.fn();
        const stopSecond = startSyncLoop(() => ({userWarehouses: [], onSynced: second}));
        release(OK(ORDER));
        await flushMicrotasks(80);

        expect(second).toHaveBeenCalledWith('42', expect.objectContaining({synced: 1, order: ORDER}));
        expect(first).not.toHaveBeenCalled();
        stopSecond();
    });

    test('with no loop running, it reports to the one that started it, as before', async () => {
        enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
        let release;
        orderService.rawUpdateOrder.mockReturnValue(new Promise((resolve) => { release = resolve; }));
        const first = jest.fn();
        const stopFirst = startSyncLoop(() => ({userWarehouses: [], onSynced: first}));
        requestSync();
        await flushMicrotasks(20);
        stopFirst();

        release(OK(ORDER));
        await flushMicrotasks(80);

        expect(first).toHaveBeenCalledWith('42', expect.objectContaining({synced: 1}));
    });
});

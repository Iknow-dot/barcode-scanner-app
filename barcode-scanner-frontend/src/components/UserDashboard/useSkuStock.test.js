import {renderHook, waitFor} from '@testing-library/react';
import {productService} from '../../api';
import useSkuStock, {STOCK_BATCH_MAX_ITEMS} from './useSkuStock';

jest.mock('../../api', () => ({productService: {fetchStock: jest.fn()}}));

const ITEMS = [
    {sku: 'S1', article: 'MG-2814', warehouse_code: 'W1', quantity: 1},
    {sku: 'S1', article: 'MG-2814', warehouse_code: 'W2', quantity: 2},
    {sku: 'S2', article: 'MG-9', warehouse_code: 'W1', quantity: 1},
];

const OK = (results) => Promise.resolve({success: true, data: {results}});

beforeEach(() => productService.fetchStock.mockReset());

test('asks for every distinct SKU in ONE request', async () => {
    productService.fetchStock.mockReturnValue(OK([
        {sku: 'MG-2814', status: 'ok', stock: [{warehouse: 'W1', quantity: 9}]},
        {sku: 'MG-9', status: 'ok', stock: [{warehouse: 'W1', quantity: 3}]},
    ]));

    const {result} = renderHook(() => useSkuStock(ITEMS, true));

    await waitFor(() => expect(result.current.stockBySku.S1).toBeDefined());
    expect(productService.fetchStock).toHaveBeenCalledTimes(1);
    expect(productService.fetchStock).toHaveBeenCalledWith({
        items: [{sku: 'MG-2814', isBarcode: false}, {sku: 'MG-9', isBarcode: false}],
        warehouseCodes: [],
    });
    expect(result.current.stockBySku).toEqual({S1: {W1: 9}, S2: {W1: 3}});
});

test('maps results back by the requested article, not the sku', async () => {
    productService.fetchStock.mockReturnValue(OK([
        {sku: 'MG-2814', status: 'ok', stock: [{warehouse: 'W2', quantity: 4}]},
    ]));
    const {result} = renderHook(() => useSkuStock([ITEMS[0]], true));
    await waitFor(() => expect(result.current.stockBySku.S1).toEqual({W2: 4}));
});

// Two distinct cart SKUs whose rows share one article: 1C can only be asked
// about the article, so both get the same answer — but each still needs it.
const SHARED = [
    {sku: 'S1', article: 'MG-2814', warehouse_code: 'W1', quantity: 1},
    {sku: 'S2', article: 'MG-2814', warehouse_code: 'W1', quantity: 1},
    {sku: 'S3', article: 'MG-9', warehouse_code: 'W1', quantity: 1},
];

test('two SKUs sharing one article both get captions from one request', async () => {
    // A lookup map holding one sku per article let the later overwrite the
    // earlier, and the earlier — already marked as requested — then showed
    // no caption for as long as the sheet stayed open.
    productService.fetchStock.mockReturnValue(OK([
        {sku: 'MG-2814', status: 'ok', stock: [{warehouse: 'W1', quantity: 9}]},
        {sku: 'MG-9', status: 'ok', stock: [{warehouse: 'W1', quantity: 3}]},
    ]));

    const {result} = renderHook(() => useSkuStock(SHARED, true));

    await waitFor(() => expect(result.current.stockBySku.S3).toBeDefined());
    expect(productService.fetchStock).toHaveBeenCalledTimes(1);
    // The shared article is asked for once, not once per SKU.
    expect(productService.fetchStock).toHaveBeenCalledWith({
        items: [{sku: 'MG-2814', isBarcode: false}, {sku: 'MG-9', isBarcode: false}],
        warehouseCodes: [],
    });
    expect(result.current.stockBySku).toEqual({S1: {W1: 9}, S2: {W1: 9}, S3: {W1: 3}});
    expect(result.current.degraded).toBe(false);
});

test.each(['unavailable', 'not_found', 'no_lookup_key'])(
    'a %s answer for a shared article leaves every SKU that asked for it uncaptioned',
    async (status) => {
        productService.fetchStock.mockReturnValue(OK([
            {sku: 'MG-2814', status, stock: []},
            {sku: 'MG-9', status: 'ok', stock: [{warehouse: 'W1', quantity: 3}]},
        ]));

        const {result} = renderHook(() => useSkuStock(SHARED, true));

        await waitFor(() => expect(result.current.stockBySku.S3).toBeDefined());
        expect(result.current.degraded).toBe(true);
        // Neither sharer is shown a false zero, and the unrelated SKU is untouched.
        expect(result.current.stockBySku).toEqual({S3: {W1: 3}});
    },
);

test('SKUs sharing an article count once toward the cap', async () => {
    // One more SKU than the cap, but two of them share an article: that is
    // exactly STOCK_BATCH_MAX_ITEMS distinct lookups, so ONE request — and
    // every SKU, both sharers included, still gets its caption.
    const items = Array.from({length: STOCK_BATCH_MAX_ITEMS + 1}, (_, i) => ({
        sku: `S${i}`,
        article: i === STOCK_BATCH_MAX_ITEMS ? 'ART-0' : `ART-${i}`,
        warehouse_code: 'W1',
        quantity: 1,
    }));
    productService.fetchStock.mockImplementation(({items: batch}) => OK(
        batch.map(({sku}) => ({sku, status: 'ok', stock: [{warehouse: 'W1', quantity: 7}]})),
    ));

    const {result} = renderHook(() => useSkuStock(items, true));

    await waitFor(() => expect(result.current.stockBySku[`S${STOCK_BATCH_MAX_ITEMS}`]).toBeDefined());
    expect(productService.fetchStock).toHaveBeenCalledTimes(1);
    expect(productService.fetchStock.mock.calls[0][0].items).toHaveLength(STOCK_BATCH_MAX_ITEMS);
    expect(Object.keys(result.current.stockBySku)).toHaveLength(STOCK_BATCH_MAX_ITEMS + 1);
    expect(result.current.stockBySku.S0).toEqual({W1: 7});
});

test('a degraded item is left undefined rather than shown as zero', async () => {
    productService.fetchStock.mockReturnValue(OK([
        {sku: 'MG-2814', status: 'unavailable', stock: []},
    ]));
    const {result} = renderHook(() => useSkuStock([ITEMS[0]], true));
    await waitFor(() => expect(productService.fetchStock).toHaveBeenCalled());
    expect(result.current.stockBySku.S1).toBeUndefined();
});

test('a degraded item reports the batch as degraded', async () => {
    // Without this the row simply has no caption, which is indistinguishable
    // from "still loading" and from "we never asked".
    productService.fetchStock.mockReturnValue(OK([
        {sku: 'MG-2814', status: 'ok', stock: [{warehouse: 'W1', quantity: 9}]},
        {sku: 'MG-9', status: 'unavailable', stock: []},
    ]));
    const {result} = renderHook(() => useSkuStock(ITEMS, true));
    await waitFor(() => expect(result.current.degraded).toBe(true));
    // The items that DID resolve are still shown.
    expect(result.current.stockBySku.S1).toEqual({W1: 9});
});

test('a fully-ok batch is not degraded', async () => {
    productService.fetchStock.mockReturnValue(OK([
        {sku: 'MG-2814', status: 'ok', stock: [{warehouse: 'W1', quantity: 9}]},
        {sku: 'MG-9', status: 'ok', stock: [{warehouse: 'W1', quantity: 3}]},
    ]));
    const {result} = renderHook(() => useSkuStock(ITEMS, true));
    await waitFor(() => expect(result.current.stockBySku.S2).toBeDefined());
    expect(result.current.degraded).toBe(false);
});

test('an in-flight request is not yet degraded', async () => {
    // A notice that showed while the answer was still out would be worse than
    // no notice: `degraded` may only be set by a RESOLVED request.
    productService.fetchStock.mockReturnValue(new Promise(() => {}));
    const {result} = renderHook(() => useSkuStock(ITEMS, true));
    await waitFor(() => expect(productService.fetchStock).toHaveBeenCalled());
    expect(result.current.degraded).toBe(false);
});

test('negative balances are hidden', async () => {
    productService.fetchStock.mockReturnValue(OK([
        {sku: 'MG-2814', status: 'ok', stock: [{warehouse: 'W1', quantity: -2}, {warehouse: 'W2', quantity: 5}]},
    ]));
    const {result} = renderHook(() => useSkuStock([ITEMS[0]], true));
    await waitFor(() => expect(result.current.stockBySku.S1).toEqual({W2: 5}));
});

test('a whole-request failure leaves every sku undefined and does not throw', async () => {
    productService.fetchStock.mockReturnValue(Promise.resolve({success: false, status: null}));
    const {result} = renderHook(() => useSkuStock(ITEMS, true));
    await waitFor(() => expect(result.current.degraded).toBe(true));
    expect(result.current.stockBySku).toEqual({});
});

test('closing forgets, reopening asks again', async () => {
    productService.fetchStock.mockReturnValue(OK([]));
    const {rerender} = renderHook(({active}) => useSkuStock(ITEMS, active), {
        initialProps: {active: true},
    });
    await waitFor(() => expect(productService.fetchStock).toHaveBeenCalledTimes(1));
    rerender({active: false});
    rerender({active: true});
    await waitFor(() => expect(productService.fetchStock).toHaveBeenCalledTimes(2));
});

test('closing clears the degraded flag too', async () => {
    productService.fetchStock.mockReturnValue(OK([
        {sku: 'MG-2814', status: 'unavailable', stock: []},
    ]));
    const {result, rerender} = renderHook(({active}) => useSkuStock([ITEMS[0]], active), {
        initialProps: {active: true},
    });
    await waitFor(() => expect(result.current.degraded).toBe(true));
    rerender({active: false});
    expect(result.current.degraded).toBe(false);
});

test('a cart past the backend cap is split into several requests', async () => {
    // The backend rejects a batch over STOCK_BATCH_MAX_ITEMS with a 400 for
    // the WHOLE request, and `requestedRef` is already populated by then — so
    // an unchunked call left every row in the cart without a caption until
    // the sheet was closed, not just the rows past the cap.
    const overCap = STOCK_BATCH_MAX_ITEMS + 1;
    const items = Array.from({length: overCap}, (_, i) => ({
        sku: `S${i}`, article: `ART-${i}`, warehouse_code: 'W1', quantity: 1,
    }));
    productService.fetchStock.mockImplementation(({items: batch}) => OK(
        batch.map(({sku}) => ({sku, status: 'ok', stock: [{warehouse: 'W1', quantity: 7}]})),
    ));

    const {result} = renderHook(() => useSkuStock(items, true));

    await waitFor(() => expect(Object.keys(result.current.stockBySku)).toHaveLength(overCap));
    expect(productService.fetchStock).toHaveBeenCalledTimes(2);
    expect(productService.fetchStock.mock.calls[0][0].items).toHaveLength(STOCK_BATCH_MAX_ITEMS);
    expect(productService.fetchStock.mock.calls[1][0].items).toHaveLength(1);
    // No request exceeds the cap, and every sku still resolves.
    expect(result.current.stockBySku[`S${overCap - 1}`]).toEqual({W1: 7});
    expect(result.current.stockBySku.S0).toEqual({W1: 7});
});

test('an inactive sheet asks for nothing', () => {
    renderHook(() => useSkuStock(ITEMS, false));
    expect(productService.fetchStock).not.toHaveBeenCalled();
});

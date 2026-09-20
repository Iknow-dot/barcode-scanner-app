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

    await waitFor(() => expect(result.current.S1).toBeDefined());
    expect(productService.fetchStock).toHaveBeenCalledTimes(1);
    expect(productService.fetchStock).toHaveBeenCalledWith({
        items: [{sku: 'MG-2814', isBarcode: false}, {sku: 'MG-9', isBarcode: false}],
        warehouseCodes: [],
    });
    expect(result.current).toEqual({S1: {W1: 9}, S2: {W1: 3}});
});

test('maps results back by the requested article, not the sku', async () => {
    productService.fetchStock.mockReturnValue(OK([
        {sku: 'MG-2814', status: 'ok', stock: [{warehouse: 'W2', quantity: 4}]},
    ]));
    const {result} = renderHook(() => useSkuStock([ITEMS[0]], true));
    await waitFor(() => expect(result.current.S1).toEqual({W2: 4}));
});

test('a degraded item is left undefined rather than shown as zero', async () => {
    productService.fetchStock.mockReturnValue(OK([
        {sku: 'MG-2814', status: 'unavailable', stock: []},
    ]));
    const {result} = renderHook(() => useSkuStock([ITEMS[0]], true));
    await waitFor(() => expect(productService.fetchStock).toHaveBeenCalled());
    expect(result.current.S1).toBeUndefined();
});

test('negative balances are hidden', async () => {
    productService.fetchStock.mockReturnValue(OK([
        {sku: 'MG-2814', status: 'ok', stock: [{warehouse: 'W1', quantity: -2}, {warehouse: 'W2', quantity: 5}]},
    ]));
    const {result} = renderHook(() => useSkuStock([ITEMS[0]], true));
    await waitFor(() => expect(result.current.S1).toEqual({W2: 5}));
});

test('a whole-request failure leaves every sku undefined and does not throw', async () => {
    productService.fetchStock.mockReturnValue(Promise.resolve({success: false, status: null}));
    const {result} = renderHook(() => useSkuStock(ITEMS, true));
    await waitFor(() => expect(productService.fetchStock).toHaveBeenCalled());
    expect(result.current).toEqual({});
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

    await waitFor(() => expect(Object.keys(result.current)).toHaveLength(overCap));
    expect(productService.fetchStock).toHaveBeenCalledTimes(2);
    expect(productService.fetchStock.mock.calls[0][0].items).toHaveLength(STOCK_BATCH_MAX_ITEMS);
    expect(productService.fetchStock.mock.calls[1][0].items).toHaveLength(1);
    // No request exceeds the cap, and every sku still resolves.
    expect(result.current[`S${overCap - 1}`]).toEqual({W1: 7});
    expect(result.current.S0).toEqual({W1: 7});
});

test('an inactive sheet asks for nothing', () => {
    renderHook(() => useSkuStock(ITEMS, false));
    expect(productService.fetchStock).not.toHaveBeenCalled();
});

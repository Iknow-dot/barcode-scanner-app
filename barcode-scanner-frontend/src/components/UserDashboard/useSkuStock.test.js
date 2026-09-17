import {act, renderHook} from '@testing-library/react';
import useSkuStock from './useSkuStock';
import {productService} from '../../api';

jest.mock('../../api', () => ({
    productService: {searchProduct: jest.fn()},
}));

const item = (overrides) => ({
    id: 1,
    sku: 'PAN',
    article: 'MG-2814',
    sku_name: 'Granite pan',
    warehouse_code: 'W1',
    warehouse_name: 'Vake',
    quantity: '2',
    price: '89.90',
    effective_price: '89.90',
    discount_percent: '0.00',
    line_total: '179.80',
    unit: 'piece',
    ...overrides,
});

describe('useSkuStock', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('fetches each sku once while active and exposes stock by warehouse', async () => {
        productService.searchProduct.mockResolvedValue({
            success: true,
            data: {stock: [{warehouse: 'W1', quantity: '9'}, {warehouse: 'W2', quantity: '3'}]},
        });

        const {result, rerender} = renderHook(
            ({items, active}) => useSkuStock(items, active),
            {initialProps: {items: [item()], active: true}},
        );
        await act(async () => {});

        expect(result.current.PAN).toEqual({W1: 9, W2: 3});
        expect(productService.searchProduct).toHaveBeenCalledTimes(1);
        expect(productService.searchProduct).toHaveBeenCalledWith({
            sku: 'MG-2814', searchType: 'article', warehouseCodes: [], includeImages: false,
        });

        // A re-render with the same (already-requested) sku must not refetch.
        rerender({items: [item()], active: true});
        await act(async () => {});
        expect(productService.searchProduct).toHaveBeenCalledTimes(1);
    });

    it('forgets everything on close, so reopening refetches', async () => {
        productService.searchProduct.mockResolvedValue({
            success: true,
            data: {stock: [{warehouse: 'W1', quantity: '5'}]},
        });

        const {result, rerender} = renderHook(
            ({items, active}) => useSkuStock(items, active),
            {initialProps: {items: [item()], active: true}},
        );
        await act(async () => {});
        expect(result.current.PAN).toEqual({W1: 5});

        rerender({items: [item()], active: false});
        expect(result.current).toEqual({});

        rerender({items: [item()], active: true});
        await act(async () => {});
        expect(productService.searchProduct).toHaveBeenCalledTimes(2);
        expect(result.current.PAN).toEqual({W1: 5});
    });

    it('leaves a failed lookup with no stock for that sku, without throwing', async () => {
        productService.searchProduct.mockResolvedValue({success: false, error: 'nope'});
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

        const {result} = renderHook(() => useSkuStock([item()], true));
        await act(async () => {});

        expect(result.current.PAN).toBeUndefined();
        warn.mockRestore();
    });
});

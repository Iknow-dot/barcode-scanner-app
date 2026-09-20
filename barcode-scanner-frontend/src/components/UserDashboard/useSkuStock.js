import {useEffect, useRef, useState} from 'react';
import {productService} from '../../api';
import groupItemsBySku from './groupItemsBySku';

/**
 * The backend rejects a batch larger than `STOCK_BATCH_MAX_ITEMS` (settings.py,
 * default 50) with a 400 for the WHOLE request. Mirrored here so a big cart
 * chunks instead: `requestedRef` is populated before the call, so one rejected
 * batch would leave every row without a caption until the sheet is closed.
 * Raise it only together with the backend setting.
 */
export const STOCK_BATCH_MAX_ITEMS = 50;

const chunk = (values, size) => {
    const out = [];
    for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
    return out;
};

/**
 * Live free stock per product for the cart's stock captions and warnings:
 * one batch request per `STOCK_BATCH_MAX_ITEMS` distinct SKUs while the sheet
 * is open — one request for any ordinary cart.
 * Returns {[sku]: {[warehouseCode]: quantity}}; a SKU the backend could not
 * resolve is left out, so its rows show no caption rather than a false zero.
 * Closing the sheet forgets everything, so the next opening asks again.
 */
const useSkuStock = (items, active) => {
    const [stockBySku, setStockBySku] = useState({});
    const requestedRef = useRef(new Set());
    const generationRef = useRef(0);

    useEffect(() => {
        if (!active) {
            if (requestedRef.current.size > 0) {
                generationRef.current += 1;
                requestedRef.current = new Set();
                setStockBySku({});
            }
            return;
        }

        const groups = groupItemsBySku(items || [])
            .filter((group) => !requestedRef.current.has(group.sku));
        if (groups.length === 0) return;
        groups.forEach((group) => requestedRef.current.add(group.sku));

        // GetStockAndPrices keys off the article (or a barcode); the canonical
        // sku is not always a valid lookup key. Results come back keyed by the
        // value we asked for, so map that back to the cart's sku.
        const skuByLookupKey = new Map(
            groups.map((group) => [group.article || group.sku, group.sku]),
        );
        const generation = generationRef.current;

        // Each chunk lands on its own, so a cart past the cap fills in waves
        // rather than losing every caption to one rejected request.
        chunk([...skuByLookupKey.keys()], STOCK_BATCH_MAX_ITEMS).forEach((keys) => {
            productService.fetchStock({
                items: keys.map((sku) => ({sku, isBarcode: false})),
                warehouseCodes: [],
            }).then((result) => {
                if (generation !== generationRef.current) return;
                if (!result.success || !Array.isArray(result.data?.results)) {
                    // eslint-disable-next-line no-console
                    console.warn('[cart] stock fetch failed', result);
                    return;
                }
                const next = {};
                result.data.results.forEach((entry) => {
                    const sku = skuByLookupKey.get(entry.sku);
                    // Only `ok` carries a trustworthy list. A degraded entry is
                    // left out so its rows show no caption instead of a false zero.
                    if (!sku || entry.status !== 'ok') return;
                    const byWarehouse = {};
                    // Hide negative balances, as the product lookup does.
                    (entry.stock || [])
                        .filter((row) => (Number(row.quantity) || 0) >= 0)
                        .forEach((row) => {
                            byWarehouse[row.warehouse] = Number(row.quantity || 0);
                        });
                    next[sku] = byWarehouse;
                });
                setStockBySku((prev) => ({...prev, ...next}));
            });
        });
    }, [items, active]);

    return stockBySku;
};

export default useSkuStock;

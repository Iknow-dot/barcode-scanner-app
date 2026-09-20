import {useEffect, useRef, useState} from 'react';
import {productService} from '../../api';
import groupItemsBySku from './groupItemsBySku';

/**
 * Live free stock per product for the cart's stock captions and warnings:
 * ONE batch request covering every distinct SKU while the sheet is open.
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

        productService.fetchStock({
            items: [...skuByLookupKey.keys()].map((sku) => ({sku, isBarcode: false})),
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
    }, [items, active]);

    return stockBySku;
};

export default useSkuStock;

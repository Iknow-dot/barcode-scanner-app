import {useEffect, useRef, useState} from 'react';
import {productService} from '../../api';
import groupItemsBySku from './groupItemsBySku';

/**
 * Live free stock per product for the cart's stock captions and warnings:
 * one lookup per SKU while the sheet is open, as each product card used to
 * make on mount. Returns {[sku]: {[warehouseCode]: quantity}}; a failed
 * lookup leaves its SKU out, so its rows show no caption. Closing the sheet
 * forgets everything, so the next opening asks again.
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
        const generation = generationRef.current;
        groupItemsBySku(items || []).forEach((group) => {
            if (requestedRef.current.has(group.sku)) return;
            requestedRef.current.add(group.sku);
            // GetStockAndPrices keys off the article (or a barcode); the
            // canonical sku is not always a valid lookup key.
            const lookupKey = group.article || group.sku;
            productService.searchProduct({
                sku: lookupKey,
                searchType: 'article',
                warehouseCodes: [],
                includeImages: false,
            }).then((result) => {
                if (generation !== generationRef.current) return;
                if (result.success && Array.isArray(result.data?.stock)) {
                    const byWarehouse = {};
                    // Hide negative balances, as the product lookup does.
                    result.data.stock
                        .filter((entry) => (Number(entry.quantity) || 0) >= 0)
                        .forEach((entry) => {
                            byWarehouse[entry.warehouse] = Number(entry.quantity || 0);
                        });
                    setStockBySku((prev) => ({...prev, [group.sku]: byWarehouse}));
                } else {
                    // eslint-disable-next-line no-console
                    console.warn('[cart] stock fetch failed for', lookupKey, result);
                }
            });
        });
    }, [items, active]);

    return stockBySku;
};

export default useSkuStock;

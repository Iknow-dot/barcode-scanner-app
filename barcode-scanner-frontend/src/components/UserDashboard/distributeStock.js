/**
 * Allocate a target quantity across warehouses, filling the user's assigned
 * tier first (stock-desc), then non-assigned warehouses (also stock-desc).
 * Pure: no React, no API.
 *
 * @param {number} target - Desired total quantity.
 * @param {Array<{warehouse: string, quantity: number}>} warehouses - Stock entries from product-search response.
 * @param {Set<string>} assignedCodes - Warehouse codes the current user is assigned to.
 * @returns {Map<string, number>} warehouse_code → allocated qty (only entries with qty > 0).
 */
const distributeStock = (target, warehouses, assignedCodes) => {
    const result = new Map();
    if (!Number.isFinite(target) || target <= 0) return result;

    const positiveStock = (warehouses || []).filter((w) => Number(w.quantity) > 0);
    const assigned = positiveStock.filter((w) => assignedCodes.has(w.warehouse));
    const others = positiveStock.filter((w) => !assignedCodes.has(w.warehouse));
    const byStockDesc = (a, b) => Number(b.quantity) - Number(a.quantity);
    assigned.sort(byStockDesc);
    others.sort(byStockDesc);

    let remaining = target;
    for (const entry of [...assigned, ...others]) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, Number(entry.quantity));
        if (take > 0) {
            result.set(entry.warehouse, take);
            remaining -= take;
        }
    }
    return result;
};

export default distributeStock;

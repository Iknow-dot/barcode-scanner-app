/**
 * Allocate a target quantity across warehouses, filling the user's assigned
 * tier first (stock-desc), then non-assigned warehouses (also stock-desc).
 * Pure: no React, no API.
 *
 * If the target exceeds the total positive stock across all warehouses, the
 * surplus is added to the highest-priority warehouse (the first one used in
 * the allocation walk). Caller is responsible for showing a "warn-and-allow"
 * UI for the over-stock case.
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
    if (positiveStock.length === 0) return result;

    const assigned = positiveStock.filter((w) => assignedCodes.has(w.warehouse));
    const others = positiveStock.filter((w) => !assignedCodes.has(w.warehouse));
    const byStockDesc = (a, b) => Number(b.quantity) - Number(a.quantity);
    assigned.sort(byStockDesc);
    others.sort(byStockDesc);
    const ordered = [...assigned, ...others];

    let remaining = target;
    for (const entry of ordered) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, Number(entry.quantity));
        if (take > 0) {
            result.set(entry.warehouse, take);
            remaining -= take;
        }
    }

    // Warn-and-allow: if there's still target left after exhausting stock,
    // add the surplus to the highest-priority warehouse (the first one in
    // the ordered walk). The salesperson has explicitly asked for this
    // quantity even though upstream stock disagrees.
    if (remaining > 0) {
        const firstCode = ordered[0].warehouse;
        result.set(firstCode, (result.get(firstCode) || 0) + remaining);
    }

    return result;
};

export default distributeStock;

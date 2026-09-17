// Home's "today's orders" card. Every order today counts toward `count`;
// "placed" means confirmed or completed (pushed to 1C), and `completed*` is the
// completed part of those. `total` repeats placedTotal for callers that still
// read the older {count, total} shape of useDailySnapshot's ordersSummary.
export const EMPTY_ORDERS_SUMMARY = Object.freeze({
    count: 0,
    total: 0,
    placedCount: 0,
    placedTotal: 0,
    completedCount: 0,
    completedTotal: 0,
});

const amount = (order) => parseFloat(order.total) || 0;

export const summarizeTodayOrders = (orders) => {
    const list = Array.isArray(orders) ? orders : [];
    const placed = list.filter((o) => o.status === 'confirmed' || o.status === 'completed');
    const completed = placed.filter((o) => o.status === 'completed');
    const placedTotal = placed.reduce((sum, o) => sum + amount(o), 0);
    return {
        count: list.length,
        total: placedTotal,
        placedCount: placed.length,
        placedTotal,
        completedCount: completed.length,
        completedTotal: completed.reduce((sum, o) => sum + amount(o), 0),
    };
};

// Completed amount as a share of the placed amount, 0..1, for the progress
// bar. 0 when nothing is placed yet.
export const completedShare = (summary) => {
    if (!summary || !(summary.placedTotal > 0)) return 0;
    return Math.min(1, Math.max(0, summary.completedTotal / summary.placedTotal));
};

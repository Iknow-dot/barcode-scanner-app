import {useCallback, useEffect, useState} from 'react';
import {orderService} from '../api';
import {getTodayScans, getTodaySummary} from '../utils/scanLog';

const RECENT_SCANS_LIMIT = 3;

const formatTodayISO = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

// Builds the recent-scans list shown on the dashboard:
//  - Drops not-found scans (those still count toward the KPI but the user
//    has no product to revisit).
//  - Keeps only the most recent scan per SKU so a single product scanned
//    five times doesn't crowd out the rest of the day's history.
const buildRecentScansView = (scans, limit) => {
    const seen = new Set();
    const out = [];
    for (const scan of scans) {
        if (!scan.found || !scan.sku) continue;
        if (seen.has(scan.sku)) continue;
        seen.add(scan.sku);
        out.push(scan);
        if (out.length >= limit) break;
    }
    return out;
};

const useDailySnapshot = (currentUserId) => {
    const [refreshTick, setRefreshTick] = useState(0);
    const [scansSummary, setScansSummary] = useState({count: 0, foundCount: 0, notFoundCount: 0});
    const [recentScans, setRecentScans] = useState([]);
    const [ordersSummary, setOrdersSummary] = useState({count: 0, total: 0});

    useEffect(() => {
        setScansSummary(getTodaySummary());
        setRecentScans(buildRecentScansView(getTodayScans(), RECENT_SCANS_LIMIT));
    }, [refreshTick]);

    useEffect(() => {
        if (!currentUserId) return undefined;
        let cancelled = false;
        const fetchToday = async () => {
            const result = await orderService.getOrders({
                created_by: currentUserId,
                date_from: formatTodayISO(),
            });
            if (cancelled) return;
            if (result.success) {
                const orders = Array.isArray(result.data)
                    ? result.data
                    : (result.data?.results || []);
                const total = orders
                    .filter((o) => o.status === 'confirmed')
                    .reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
                setOrdersSummary({count: orders.length, total});
            }
        };
        fetchToday();
        return () => { cancelled = true; };
    }, [currentUserId, refreshTick]);

    const refresh = useCallback(() => {
        setRefreshTick((tick) => tick + 1);
    }, []);

    return {scansSummary, recentScans, ordersSummary, refresh};
};

export default useDailySnapshot;

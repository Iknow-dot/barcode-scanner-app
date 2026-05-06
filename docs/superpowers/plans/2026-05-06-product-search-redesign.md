# Product Search Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the duplicate-button empty state with a daily activity snapshot, and tighten the product-loaded layout into a horizontal hero + sectioned warehouse list with a stock-meter visualization. Frontend-only.

**Architecture:** Add two utility modules (`scanLog` for localStorage persistence, `formatRelativeTime` for "12 min ago" rendering), one hook (`useDailySnapshot`) that combines scan log data with `orderService.getOrders` for "today", and one new component (`DailySnapshot`) for the empty state. Modify `UserDashboard.js` to use the new empty state and refactor the product-results JSX into a hero card + two warehouse sections, wiring `recordScan` into the existing `handleSearch` flow.

**Tech Stack:** React 18 + Ant Design 6 (existing project conventions), CRA jest for tests, `localStorage` for client-side scan persistence. No backend changes — `OrderViewSet.get_queryset` already supports `date_from` + `created_by` filters.

**Greeting note:** The JWT login response (`backend/users/serializers.py:118-123`) only exposes `id`, `username`, `can_apply_discount`, `max_discount_percent` on `data['user']` — no `first_name`. To avoid touching the backend, the greeting uses `username` (e.g. `Good afternoon, nikat`). If a future iteration wants real names, that requires adding `first_name` to the JWT response — out of scope here.

---

## Task 1: scanLog utility

**Files:**
- Create: `barcode-scanner-frontend/src/utils/scanLog.js`
- Test: `barcode-scanner-frontend/src/utils/scanLog.test.js`

The scan log persists to `localStorage` under key `barcode-scanner.scanLog`. Entries are pruned to last 50 / 24h on every write.

- [ ] **Step 1: Write the failing test file**

Create `barcode-scanner-frontend/src/utils/scanLog.test.js`:

```js
import {recordScan, getTodayScans, getTodaySummary, _resetForTest} from './scanLog';

const STORAGE_KEY = 'barcode-scanner.scanLog';

const mkScan = (overrides) => ({
    search: '5901234123457',
    searchType: 'barcode',
    found: true,
    sku: 'BOS-DR-2026',
    sku_name: 'Bosch Drill',
    price: 280,
    total_qty: 15,
    scanned_at: Date.now(),
    ...overrides,
});

describe('scanLog', () => {
    beforeEach(() => {
        window.localStorage.clear();
        _resetForTest();
    });

    describe('with empty storage', () => {
        it('getTodayScans returns []', () => {
            expect(getTodayScans()).toEqual([]);
        });

        it('getTodaySummary returns zero counts', () => {
            expect(getTodaySummary()).toEqual({count: 0, foundCount: 0, notFoundCount: 0});
        });
    });

    describe('recordScan', () => {
        it('persists a scan to localStorage', () => {
            recordScan(mkScan());
            const raw = window.localStorage.getItem(STORAGE_KEY);
            expect(JSON.parse(raw)).toHaveLength(1);
        });

        it('prepends new entries (newest first)', () => {
            recordScan(mkScan({search: 'first'}));
            recordScan(mkScan({search: 'second'}));
            const scans = getTodayScans();
            expect(scans[0].search).toBe('second');
            expect(scans[1].search).toBe('first');
        });

        it('survives a corrupted storage value', () => {
            window.localStorage.setItem(STORAGE_KEY, 'not json');
            expect(() => recordScan(mkScan())).not.toThrow();
            expect(getTodayScans()).toHaveLength(1);
        });
    });

    describe('day scoping', () => {
        it('excludes entries from yesterday', () => {
            const yesterday = Date.now() - 25 * 60 * 60 * 1000;
            recordScan(mkScan({search: 'old', scanned_at: yesterday}));
            recordScan(mkScan({search: 'new'}));
            const scans = getTodayScans();
            expect(scans).toHaveLength(1);
            expect(scans[0].search).toBe('new');
        });

        it('summary counts only today', () => {
            const yesterday = Date.now() - 25 * 60 * 60 * 1000;
            recordScan(mkScan({scanned_at: yesterday}));
            recordScan(mkScan({found: true}));
            recordScan(mkScan({found: false}));
            expect(getTodaySummary()).toEqual({count: 2, foundCount: 1, notFoundCount: 1});
        });
    });

    describe('pruning', () => {
        it('prunes entries past the 50-entry cap', () => {
            for (let i = 0; i < 60; i++) {
                recordScan(mkScan({search: `s${i}`, scanned_at: Date.now() - i}));
            }
            const raw = window.localStorage.getItem(STORAGE_KEY);
            expect(JSON.parse(raw)).toHaveLength(50);
        });

        it('prunes entries older than 24h on write', () => {
            const old = Date.now() - 48 * 60 * 60 * 1000;
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify([
                mkScan({search: 'old', scanned_at: old}),
            ]));
            recordScan(mkScan({search: 'new'}));
            const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
            expect(raw).toHaveLength(1);
            expect(raw[0].search).toBe('new');
        });
    });

    describe('storage failures', () => {
        it('does not throw when localStorage.setItem fails', () => {
            const original = window.localStorage.setItem;
            window.localStorage.setItem = () => { throw new Error('quota exceeded'); };
            expect(() => recordScan(mkScan())).not.toThrow();
            window.localStorage.setItem = original;
        });
    });
});
```

- [ ] **Step 2: Run the failing test**

Run: `cd barcode-scanner-frontend && npm test -- --watchAll=false src/utils/scanLog.test.js`
Expected: Cannot find module `./scanLog` (or similar) — file doesn't exist yet.

- [ ] **Step 3: Write the scanLog implementation**

Create `barcode-scanner-frontend/src/utils/scanLog.js`:

```js
const STORAGE_KEY = 'barcode-scanner.scanLog';
const MAX_ENTRIES = 50;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const isSameDay = (ts) => {
    const a = new Date(ts);
    const b = new Date();
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
};

const safeRead = () => {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.warn('scanLog: failed to read storage', err);
        return [];
    }
};

const safeWrite = (entries) => {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (err) {
        console.warn('scanLog: failed to write storage', err);
    }
};

export const recordScan = (entry) => {
    const now = Date.now();
    const next = [{...entry, scanned_at: entry.scanned_at || now}, ...safeRead()];
    const pruned = next
        .filter((e) => now - e.scanned_at < MAX_AGE_MS)
        .slice(0, MAX_ENTRIES);
    safeWrite(pruned);
};

export const getTodayScans = () => {
    return safeRead().filter((e) => isSameDay(e.scanned_at));
};

export const getTodaySummary = () => {
    const today = getTodayScans();
    const foundCount = today.filter((e) => e.found).length;
    return {
        count: today.length,
        foundCount,
        notFoundCount: today.length - foundCount,
    };
};

// Test-only: lets tests reset any module-level cache. Currently there is no
// cache, but exporting this keeps the test contract stable if one is added.
export const _resetForTest = () => {};
```

- [ ] **Step 4: Run the test, verify all pass**

Run: `cd barcode-scanner-frontend && npm test -- --watchAll=false src/utils/scanLog.test.js`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add barcode-scanner-frontend/src/utils/scanLog.js barcode-scanner-frontend/src/utils/scanLog.test.js
git commit -m "$(cat <<'EOF'
feat(scan-log): add localStorage scan history util

Stores recent scans (≤50, ≤24h) keyed by 'barcode-scanner.scanLog'.
Provides today-scoped getTodayScans / getTodaySummary helpers used
by the dashboard's daily snapshot.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: formatRelativeTime utility

**Files:**
- Create: `barcode-scanner-frontend/src/utils/formatRelativeTime.js`
- Test: `barcode-scanner-frontend/src/utils/formatRelativeTime.test.js`

A pure function that turns a timestamp + the `t` translation object into a "12 min ago" string.

- [ ] **Step 1: Write the failing test file**

Create `barcode-scanner-frontend/src/utils/formatRelativeTime.test.js`:

```js
import formatRelativeTime from './formatRelativeTime';

const t = {
    justNow: 'just now',
    minAgo: (n) => `${n} min ago`,
    hoursAgo: (n) => `${n}h ago`,
};

describe('formatRelativeTime', () => {
    const now = Date.now();

    it('returns justNow for < 60s', () => {
        expect(formatRelativeTime(now - 5000, t)).toBe('just now');
        expect(formatRelativeTime(now - 59 * 1000, t)).toBe('just now');
    });

    it('returns minAgo for 1–59 min', () => {
        expect(formatRelativeTime(now - 60 * 1000, t)).toBe('1 min ago');
        expect(formatRelativeTime(now - 12 * 60 * 1000, t)).toBe('12 min ago');
        expect(formatRelativeTime(now - 59 * 60 * 1000, t)).toBe('59 min ago');
    });

    it('returns hoursAgo for 1–23h', () => {
        expect(formatRelativeTime(now - 60 * 60 * 1000, t)).toBe('1h ago');
        expect(formatRelativeTime(now - 5 * 60 * 60 * 1000, t)).toBe('5h ago');
    });

    it('falls back to a localized date for ≥ 24h', () => {
        const old = now - 48 * 60 * 60 * 1000;
        const result = formatRelativeTime(old, t);
        expect(result).toBe(new Date(old).toLocaleDateString());
    });
});
```

- [ ] **Step 2: Run the failing test**

Run: `cd barcode-scanner-frontend && npm test -- --watchAll=false src/utils/formatRelativeTime.test.js`
Expected: Cannot find module `./formatRelativeTime`.

- [ ] **Step 3: Write the implementation**

Create `barcode-scanner-frontend/src/utils/formatRelativeTime.js`:

```js
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const formatRelativeTime = (ms, t) => {
    const delta = Date.now() - ms;
    if (delta < MIN) return t.justNow;
    if (delta < HOUR) return t.minAgo(Math.floor(delta / MIN));
    if (delta < DAY) return t.hoursAgo(Math.floor(delta / HOUR));
    return new Date(ms).toLocaleDateString();
};

export default formatRelativeTime;
```

- [ ] **Step 4: Run the test, verify all pass**

Run: `cd barcode-scanner-frontend && npm test -- --watchAll=false src/utils/formatRelativeTime.test.js`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add barcode-scanner-frontend/src/utils/formatRelativeTime.js barcode-scanner-frontend/src/utils/formatRelativeTime.test.js
git commit -m "$(cat <<'EOF'
feat(util): add formatRelativeTime helper

Maps a timestamp to 'just now' / 'N min ago' / 'Nh ago' / locale
date based on age, using the translation object for copy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Translation keys

**Files:**
- Modify: `barcode-scanner-frontend/src/i18n/translations.js`

Add new keys to both the `ka:` block (line 2) and the `en:` block (line 493). The Georgian copy can be refined later by the user; the goal here is parity.

- [ ] **Step 1: Add Georgian (ka) keys**

In `translations.js`, find the existing line `noOrders: 'შეკვეთები არ არის',` (around line 419) inside the `ka:` block. Add the following keys directly after it (and before the `// ===== Delivery =====` comment):

```js
        // ===== Daily snapshot (empty state) =====
        greetingMorning: 'დილა მშვიდობისა',
        greetingAfternoon: 'შუადღე მშვიდობისა',
        greetingEvening: 'საღამო მშვიდობისა',
        dashboardSubtitle: 'აი შენი დღევანდელი აქტივობა',
        scansToday: 'დღევანდელი სკანერები',
        ordersToday: 'დღევანდელი შეკვეთები',
        foundCount: (n) => `${n} ნაპოვნი`,
        notFoundCount: (n) => `${n} ვერ მოიძებნა`,
        currencyTotal: (v) => `${v} ₾ ჯამი`,
        recentScans: 'ბოლო სკანერები',
        noScansToday: 'დღეს ჯერ არ დასკანერებულა',
        notFound: 'ვერ მოიძებნა',
        today: 'დღეს',
        justNow: 'ახლახან',
        minAgo: (n) => `${n} წუთის წინ`,
        hoursAgo: (n) => `${n} სთ წინ`,
        myWarehouses: 'ჩემი საწყობები',
        otherWarehouses: 'სხვა საწყობები',
        seeAllWarehouses: 'ყველა საწყობის ნახვა',
        lowStock: 'მცირე ნაშთი',
        outOfStock: 'არ არის ნაშთი',
        inStock: (n) => `${n} მარაგშია`,
```

- [ ] **Step 2: Add English (en) keys**

In `translations.js`, find the existing line `noOrders: 'No orders',` (around line 910) inside the `en:` block. Add the following keys directly after it:

```js
        // ===== Daily snapshot (empty state) =====
        greetingMorning: 'Good morning',
        greetingAfternoon: 'Good afternoon',
        greetingEvening: 'Good evening',
        dashboardSubtitle: "Here's your activity today",
        scansToday: 'Scans today',
        ordersToday: 'Orders today',
        foundCount: (n) => `${n} found`,
        notFoundCount: (n) => `${n} not found`,
        currencyTotal: (v) => `${v} ₾ total`,
        recentScans: 'Recent scans',
        noScansToday: 'No scans yet today',
        notFound: 'Not found',
        today: 'Today',
        justNow: 'just now',
        minAgo: (n) => `${n} min ago`,
        hoursAgo: (n) => `${n}h ago`,
        myWarehouses: 'My warehouses',
        otherWarehouses: 'Other warehouses',
        seeAllWarehouses: 'See all warehouses',
        lowStock: 'Low stock',
        outOfStock: 'Out of stock',
        inStock: (n) => `${n} in stock`,
```

- [ ] **Step 3: Verify translations parse**

`translations.js` is ESM (`export default translations;`), so the cleanest check is to start the dev server briefly and confirm a clean compile.

Run: `cd barcode-scanner-frontend && npm start`

Wait for `Compiled successfully!` in the terminal, then Ctrl+C. If the compile fails (syntax error, trailing comma issue, etc.), fix it before continuing.

- [ ] **Step 4: Commit**

```bash
git add barcode-scanner-frontend/src/i18n/translations.js
git commit -m "$(cat <<'EOF'
feat(i18n): add daily snapshot keys (ka + en)

Adds greetings, KPI labels, recent-scan copy, relative-time helpers,
and warehouse-section labels in both languages.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: useDailySnapshot hook

**Files:**
- Create: `barcode-scanner-frontend/src/hooks/useDailySnapshot.js`

Combines today's scan log (from localStorage) with today's orders (from `orderService.getOrders`) and exposes a `refresh` function so consumers can re-pull after a scan/order mutation.

- [ ] **Step 1: Create the hook**

Create `barcode-scanner-frontend/src/hooks/useDailySnapshot.js`:

```js
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

const useDailySnapshot = (currentUserId) => {
    const [refreshTick, setRefreshTick] = useState(0);
    const [scansSummary, setScansSummary] = useState({count: 0, foundCount: 0, notFoundCount: 0});
    const [recentScans, setRecentScans] = useState([]);
    const [ordersSummary, setOrdersSummary] = useState({count: 0, total: 0});

    useEffect(() => {
        setScansSummary(getTodaySummary());
        setRecentScans(getTodayScans().slice(0, RECENT_SCANS_LIMIT));
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
```

- [ ] **Step 2: Commit**

```bash
git add barcode-scanner-frontend/src/hooks/useDailySnapshot.js
git commit -m "$(cat <<'EOF'
feat(hooks): add useDailySnapshot

Combines today's scan log with today's orders (filtered by current
user via getOrders) and exposes a refresh handle for callers to
trigger a re-pull after a scan or order mutation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: CSS additions

**Files:**
- Modify: `barcode-scanner-frontend/src/index.css`

Add the new `.m-*` classes for the daily snapshot, the redesigned product hero, the warehouse section pieces, and the stock meter. Append at the end of the existing mobile-first dashboard block (after line ~672 `/* ===== Dark mode support ===== */` block) so the dark-mode overrides land near their light-mode siblings.

- [ ] **Step 1: Add new light-mode classes**

In `index.css`, find the closing brace of the existing `.m-product-image { ... }` block (around line 367). After the line `}` (closing that block), add the following CSS as a new block before the existing `/* ===== Balance Section ===== */` comment:

```css
/* ===== Daily snapshot (empty state) ===== */
.m-daily-snapshot {
  padding: 4px 4px 0;
}

.m-greeting {
  text-align: center;
  padding: 4px 8px 18px;
}

.m-greeting-text {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 4px;
}

.m-greeting-sub {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.5);
}

.m-kpi-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 8px;
}

.m-kpi-card {
  border-radius: 14px;
  padding: 12px 14px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  background: #fff;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.03);
  position: relative;
  overflow: hidden;
}

.m-kpi-card.blue {
  background: linear-gradient(135deg, #e6f4ff 0%, #bae0ff 100%);
  border-color: #91caff;
}

.m-kpi-card.green {
  background: linear-gradient(135deg, #f6ffed 0%, #d9f7be 100%);
  border-color: #b7eb8f;
}

.m-kpi-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  gap: 5px;
}

.m-kpi-value {
  font-size: 26px;
  font-weight: 800;
  line-height: 1.1;
  margin-top: 6px;
  letter-spacing: -0.5px;
}

.m-kpi-meta {
  font-size: 11px;
  color: rgba(0, 0, 0, 0.5);
  margin-top: 2px;
}

/* ===== Recent scans list ===== */
.m-recent-scans .ant-card-body {
  padding: 4px 8px;
}

.m-recent-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 4px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background-color 0.15s ease;
}

.m-recent-row:last-child {
  border-bottom: none;
}

.m-recent-row:active {
  background-color: rgba(22, 119, 255, 0.06);
}

.m-recent-thumb {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: linear-gradient(135deg, #f0f2f5 0%, #d9e2ec 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: rgba(0, 0, 0, 0.3);
  flex-shrink: 0;
}

.m-recent-thumb-notfound {
  background: linear-gradient(135deg, #fff2f0 0%, #ffccc7 100%);
  color: #cf1322;
}

.m-recent-info {
  flex: 1;
  min-width: 0;
}

.m-recent-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.m-recent-meta {
  font-size: 11px;
  color: rgba(0, 0, 0, 0.5);
  margin-top: 1px;
}

/* ===== Product hero (replaces .m-product-card structural use) ===== */
.m-product-hero {
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 16px;
  overflow: hidden;
  margin-bottom: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
}

.m-product-hero-img {
  width: 100%;
  aspect-ratio: 21 / 9;
  object-fit: contain;
  background: #fafafa;
  display: block;
}

.m-product-hero-img.placeholder {
  background: linear-gradient(135deg, #f0f2f5 0%, #d9e2ec 100%);
}

.m-product-hero-body {
  padding: 10px 14px 12px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}

.m-product-hero-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
  margin: 0;
}

.m-product-hero-article {
  font-size: 11px;
  color: rgba(0, 0, 0, 0.5);
  margin-top: 3px;
}

.m-product-hero-price {
  font-size: 18px;
  font-weight: 700;
  color: #1677ff;
  white-space: nowrap;
}

/* ===== Warehouse section + stock meter ===== */
.m-warehouse-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 4px 8px;
  font-size: 13px;
  font-weight: 600;
}

.m-warehouse-section-header.mine {
  color: #1677ff;
}

.m-balance-qty-num {
  font-weight: 700;
  font-size: 16px;
  color: #389e0d;
  line-height: 1;
  min-width: 20px;
  text-align: right;
}

.m-balance-qty-num.low {
  color: #faad14;
}

.m-balance-qty-num.empty {
  color: rgba(0, 0, 0, 0.3);
}

.m-stock-meter {
  height: 5px;
  border-radius: 3px;
  background: #f0f0f0;
  overflow: hidden;
  margin-top: 8px;
}

.m-stock-meter > .fill {
  height: 100%;
  background: #52c41a;
  border-radius: 3px;
  transition: width 0.25s ease;
}

.m-stock-meter > .fill.low {
  background: #faad14;
}

.m-stock-meter > .fill.empty {
  width: 0;
}

.m-low-stock-label {
  font-size: 10px;
  color: #faad14;
  font-weight: 600;
  margin-top: 4px;
}
```

- [ ] **Step 2: Add dark-mode overrides**

In `index.css`, find the existing `.dark-theme .m-empty-icon { ... }` block (around line 717). After its closing brace, add the following dark-mode overrides:

```css
.dark-theme .m-greeting-sub {
  color: rgba(255, 255, 255, 0.5);
}

.dark-theme .m-kpi-card {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}

.dark-theme .m-kpi-card.blue {
  background: linear-gradient(135deg, rgba(22, 119, 255, 0.15) 0%, rgba(22, 119, 255, 0.06) 100%);
  border-color: rgba(22, 119, 255, 0.3);
}

.dark-theme .m-kpi-card.green {
  background: linear-gradient(135deg, rgba(82, 196, 26, 0.15) 0%, rgba(82, 196, 26, 0.06) 100%);
  border-color: rgba(82, 196, 26, 0.3);
}

.dark-theme .m-kpi-label {
  color: rgba(255, 255, 255, 0.55);
}

.dark-theme .m-kpi-meta {
  color: rgba(255, 255, 255, 0.5);
}

.dark-theme .m-recent-row {
  border-bottom-color: rgba(255, 255, 255, 0.06);
}

.dark-theme .m-recent-thumb {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.02) 100%);
  color: rgba(255, 255, 255, 0.4);
}

.dark-theme .m-recent-meta {
  color: rgba(255, 255, 255, 0.5);
}

.dark-theme .m-product-hero {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}

.dark-theme .m-product-hero-img {
  background: #1a1a1a;
}

.dark-theme .m-stock-meter {
  background: rgba(255, 255, 255, 0.08);
}
```

- [ ] **Step 3: Visual smoke test**

Run: `cd barcode-scanner-frontend && npm start` and wait for compile.

Open `http://localhost:3000` in a browser, sign in, and confirm the product-search page still renders without errors. (The visual changes don't take effect yet — this step only confirms the new CSS doesn't break parsing.)

Stop the dev server with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add barcode-scanner-frontend/src/index.css
git commit -m "$(cat <<'EOF'
style(dashboard): add CSS for daily snapshot + redesigned product results

Adds .m-greeting, .m-kpi-*, .m-recent-*, .m-product-hero, .m-stock-meter,
and dark-mode variants. No JSX consumers yet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: DailySnapshot component

**Files:**
- Create: `barcode-scanner-frontend/src/components/UserDashboard/DailySnapshot.js`

A presentational component that takes the snapshot data (from the hook) plus a `username` and an `onResearch` callback, and renders the empty-state UI.

- [ ] **Step 1: Create the component**

Create `barcode-scanner-frontend/src/components/UserDashboard/DailySnapshot.js`:

```js
import React from 'react';
import {Card, Empty, Flex, Tag, Typography} from 'antd';
import {
    BarcodeOutlined,
    CheckOutlined,
    ClockCircleOutlined,
    ShoppingOutlined,
    WarningOutlined,
} from '@ant-design/icons';
import {useLanguage} from '../../i18n/LanguageContext';
import formatRelativeTime from '../../utils/formatRelativeTime';

const {Text} = Typography;

const greetingForHour = (hour, t) => {
    if (hour < 12) return t.greetingMorning;
    if (hour < 18) return t.greetingAfternoon;
    return t.greetingEvening;
};

const DailySnapshot = ({username, scansSummary, recentScans, ordersSummary, onResearch}) => {
    const {t} = useLanguage();
    const greeting = greetingForHour(new Date().getHours(), t);
    const displayName = username || '';

    return (
        <div className="m-daily-snapshot">
            <div className="m-greeting">
                <div className="m-greeting-text">
                    {displayName ? `${greeting}, ${displayName}` : greeting}
                </div>
                <div className="m-greeting-sub">{t.dashboardSubtitle}</div>
            </div>

            <div className="m-kpi-row">
                <div className="m-kpi-card blue">
                    <div className="m-kpi-label">
                        <BarcodeOutlined/> {t.scansToday}
                    </div>
                    <div className="m-kpi-value">{scansSummary.count}</div>
                    {scansSummary.count > 0 && (
                        <div className="m-kpi-meta">
                            {t.foundCount(scansSummary.foundCount)} · {t.notFoundCount(scansSummary.notFoundCount)}
                        </div>
                    )}
                </div>
                <div className="m-kpi-card green">
                    <div className="m-kpi-label">
                        <ShoppingOutlined/> {t.ordersToday}
                    </div>
                    <div className="m-kpi-value">{ordersSummary.count}</div>
                    {ordersSummary.count > 0 && (
                        <div className="m-kpi-meta">
                            {t.currencyTotal(ordersSummary.total.toFixed(2))}
                        </div>
                    )}
                </div>
            </div>

            <Flex align="center" gap={6} className="m-warehouse-section-header">
                <ClockCircleOutlined style={{color: '#1677ff'}}/>
                <Text strong style={{fontSize: 13}}>{t.recentScans}</Text>
                <Tag style={{marginLeft: 4}}>{t.today}</Tag>
            </Flex>

            <Card className="m-recent-scans" bordered={false}>
                {recentScans.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={
                            <Text type="secondary" style={{fontSize: 13}}>{t.noScansToday}</Text>
                        }
                        style={{margin: '12px 0'}}
                    />
                ) : (
                    recentScans.map((scan) => (
                        <div
                            key={scan.scanned_at}
                            className="m-recent-row"
                            onClick={() => onResearch && onResearch(scan)}
                        >
                            <div className={`m-recent-thumb ${scan.found ? '' : 'm-recent-thumb-notfound'}`}>
                                {scan.found ? <BarcodeOutlined/> : <WarningOutlined/>}
                            </div>
                            <div className="m-recent-info">
                                <div className="m-recent-name">
                                    {scan.found ? scan.sku_name : scan.search}
                                </div>
                                <div className="m-recent-meta">
                                    {scan.found
                                        ? `${formatRelativeTime(scan.scanned_at, t)} · ${scan.price} ₾ · ${t.inStock(scan.total_qty)}`
                                        : `${formatRelativeTime(scan.scanned_at, t)} · ${t.notFound}`}
                                </div>
                            </div>
                            {scan.found
                                ? <Tag color="green"><CheckOutlined/></Tag>
                                : <Tag>—</Tag>}
                        </div>
                    ))
                )}
            </Card>
        </div>
    );
};

export default DailySnapshot;
```

- [ ] **Step 2: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/DailySnapshot.js
git commit -m "$(cat <<'EOF'
feat(dashboard): add DailySnapshot empty-state component

Greeting + 2 KPI cards (Scans today / Orders today) + Recent scans
card with up to 3 rows. Tap a row to invoke onResearch with the
stored scan entry.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire DailySnapshot into UserDashboard's empty state

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js`

Replace the existing empty-state JSX (the QR icon + scan/search buttons) with `<DailySnapshot/>` driven by `useDailySnapshot`. Also wire `recordScan` into `handleSearch` so the snapshot reflects scans immediately.

- [ ] **Step 1: Add new imports**

At the top of `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js` (line 1-18 area), add the following imports near the existing util imports:

Find the line:

```js
import {printInvoice} from '../../utils/printInvoice';
```

Add these three lines immediately after it:

```js
import {recordScan} from '../../utils/scanLog';
import useDailySnapshot from '../../hooks/useDailySnapshot';
import DailySnapshot from './DailySnapshot';
```

- [ ] **Step 2: Wire the hook into the component**

Find the line `const currentUserId = authData?.user?.id;` (around line 132). Immediately after it, add:

```js
    const {
        scansSummary: snapshotScans,
        recentScans: snapshotRecent,
        ordersSummary: snapshotOrders,
        refresh: refreshSnapshot,
    } = useDailySnapshot(currentUserId);
```

- [ ] **Step 3: Add scan recording inside handleSearch**

Inside `handleSearch` (around line 188-246), find the `if (result.success && result.data?.stock) {` branch. After the existing `setBalances(result.data.stock);` line, add:

```js
                recordScan({
                    search,
                    searchType,
                    found: true,
                    sku: result.data.sku,
                    sku_name: result.data.sku_name,
                    price: result.data.price,
                    total_qty: (result.data.stock || []).reduce(
                        (sum, b) => sum + (Number(b.quantity) || 0), 0,
                    ),
                });
                refreshSnapshot();
```

Then in the `else` branch (`} else {` around line 219), find where `setBalances([]);` is set. After the existing `if (!result.success) { ... } else { ... }` block (around line 240), but **only when** the failure is `PRODUCT_NOT_FOUND` (not an `EXTERNAL_SERVICE_*` infra error), record a not-found scan and refresh.

Replace the existing `else` body (from `playNotFoundSound();` through the closing brace of the inner `if/else` at line ~240) with:

```js
                playNotFoundSound();
                setBalances([]);
                setProductInfo({sku_name: '', article: '', price: '', images: []});
                setSearchedAllWarehouses(false);

                const isExternalServiceError = result.code && result.code.startsWith('EXTERNAL_SERVICE_');

                if (!result.success) {
                    const errorMessages = {
                        'PRODUCT_NOT_FOUND': t.productNotFound,
                        'EXTERNAL_SERVICE_TIMEOUT': t.externalServiceTimeout,
                        'EXTERNAL_SERVICE_UNAVAILABLE': t.externalServiceUnavailable,
                        'EXTERNAL_SERVICE_ERROR': t.externalServiceError,
                        'EXTERNAL_SERVICE_UNAUTHORIZED': t.externalServiceUnauthorized,
                    };

                    const title = isExternalServiceError ? t.webServiceError : t.error;
                    const errorMessage = errorMessages[result.code] || t.productSearchError;
                    notify.error(title, errorMessage);
                } else {
                    notify.warning(t.result, t.productNotFoundOrNoBalance);
                }

                if (!isExternalServiceError) {
                    recordScan({
                        search,
                        searchType,
                        found: false,
                        sku: null,
                        sku_name: null,
                        price: null,
                        total_qty: null,
                    });
                    refreshSnapshot();
                }
```

- [ ] **Step 4: Add a re-search-from-history handler**

After `handleShowOtherWarehouses` (around line 263), add:

```js
    const handleResearchFromHistory = useCallback((entry) => {
        handleSearch({
            search: entry.search,
            searchType: entry.searchType,
            allWarehouses: form.getFieldValue('allWarehouses'),
        });
    }, [handleSearch, form]);
```

- [ ] **Step 5: Replace the empty-state JSX**

Find the `{/* Empty product state */}` block inside `renderScanTab` (around line 532). Replace the entire `{showEmptyProductState && ( ... )}` block (from the comment through its closing `)}`) with:

```jsx
            {/* Empty product state — daily snapshot */}
            {showEmptyProductState && (
                <DailySnapshot
                    username={authData?.user?.username}
                    scansSummary={snapshotScans}
                    recentScans={snapshotRecent}
                    ordersSummary={snapshotOrders}
                    onResearch={handleResearchFromHistory}
                />
            )}
```

(The Spin wrapper is dropped — the empty state isn't loading anything.)

- [ ] **Step 6: Refresh snapshot when an order is confirmed**

Find `handleProceedToPayment` (around line 333). After `fetchIncompleteOrders();` (the line just before `Modal.confirm(...)`), add:

```js
        refreshSnapshot();
```

This makes the green KPI card's ₾ total bump immediately when the user confirms an order.

- [ ] **Step 7: Smoke test the empty state**

Run: `cd barcode-scanner-frontend && npm start`

Open `http://localhost:3000`, sign in as a `company_user`, and confirm:
- The product page shows the greeting, two KPI cards (Scans today: 0 / Orders today: 0 if no orders), and a "No scans yet today" Empty state in the Recent scans card.
- The bottom-bar Scan and Search buttons still work.
- Performing a successful scan returns the user to the product results view (existing behavior).
- Returning to the empty state by clearing the product (e.g. log out + log back in, or scan an unknown SKU twice) shows updated counts.

If anything is broken, fix it before continuing.

Stop the dev server with Ctrl+C.

- [ ] **Step 8: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js
git commit -m "$(cat <<'EOF'
feat(dashboard): replace empty-state hero with daily snapshot

Empty state now shows a greeting, two KPI cards (scans today,
orders today), and a recent-scans list driven by useDailySnapshot.
Scans are recorded into localStorage on search (success and
PRODUCT_NOT_FOUND only — infra errors are skipped). Tapping a
recent row re-runs the same search.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Refactor product results layout

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js`

Replace the `m-product-card` + `m-balance-section` blocks with the new product hero and two-section warehouse layout.

- [ ] **Step 1: Add layout constants near the top of the component**

Find the line `const ORDER_STATUS_COLOR = { ... }` (around line 64). Immediately after its closing brace, add:

```js
const LOW_STOCK_THRESHOLD = 5;
const MAX_STOCK_FOR_FULL_BAR = 15;
```

- [ ] **Step 2: Add a renderWarehouseRow helper inside the component**

Inside the `UserDashboard` function, after `const handleResearchFromHistory = useCallback(...)` (added in Task 7 step 4), add:

```js
    const renderWarehouseRow = (item, isMine) => {
        const qty = Number(item.quantity) || 0;
        const isEmpty = qty === 0;
        const isLow = qty > 0 && qty <= LOW_STOCK_THRESHOLD;
        const fillPct = Math.min(100, (qty / MAX_STOCK_FOR_FULL_BAR) * 100);
        const qtyClass = isEmpty ? 'empty' : isLow ? 'low' : '';
        const fillClass = isEmpty ? 'empty' : isLow ? 'low' : '';

        return (
            <div
                key={`${item.warehouse}-${item.warehouse_name}`}
                className={`m-balance-card ${isMine ? 'm-balance-card-highlight' : ''}`}
            >
                <Flex justify="space-between" align="flex-start" gap={12}>
                    <div style={{flex: 1, minWidth: 0}}>
                        <Text
                            strong={isMine}
                            className="m-balance-warehouse"
                            ellipsis
                        >
                            {item.warehouse_name}
                        </Text>
                        <Text type="secondary" style={{fontSize: 12, display: 'block', marginTop: 2}}>
                            {item.price} ₾
                        </Text>
                    </div>
                    <Flex align="center" gap={8}>
                        <span className={`m-balance-qty-num ${qtyClass}`}>{qty}</span>
                        {showOrderPanel && (
                            <Button
                                type="primary"
                                size="middle"
                                icon={<PlusCircleOutlined/>}
                                onClick={(e) => handleAddToOrderFromWarehouse(item, e)}
                                disabled={qty <= 0}
                                className="m-add-to-order-btn"
                            />
                        )}
                    </Flex>
                </Flex>
                <div className="m-stock-meter">
                    <div
                        className={`fill ${fillClass}`}
                        style={isEmpty ? undefined : {width: `${fillPct}%`}}
                    />
                </div>
                {isLow && (
                    <div className="m-low-stock-label">{t.lowStock}</div>
                )}
            </div>
        );
    };
```

- [ ] **Step 3: Add a renderWarehouseSection helper**

Immediately after `renderWarehouseRow`, add:

```js
    const renderWarehouseSection = (items, isMine) => {
        if (items.length === 0) return null;
        return (
            <>
                <div className={`m-warehouse-section-header ${isMine ? 'mine' : ''}`}>
                    {isMine ? '⭐ ' : '🏬 '}
                    <Text strong style={{fontSize: 13, color: 'inherit'}}>
                        {isMine ? t.myWarehouses : t.otherWarehouses}
                    </Text>
                    <Tag style={{marginLeft: 4}}>{items.length}</Tag>
                </div>
                <div className="m-balance-list">
                    {items.map((item) => renderWarehouseRow(item, isMine))}
                </div>
            </>
        );
    };
```

- [ ] **Step 4: Replace the product results JSX**

Find the `{/* Product Results */}` block inside `renderScanTab` (around line 569). Replace the entire `{!scannerOpen && hasResults && ( ... )}` block with:

```jsx
            {/* Product Results */}
            {!scannerOpen && hasResults && (
                <Spin spinning={loading} tip={t.searchingProduct} size="large">
                    <div className="m-product-results">
                        {/* Product Hero */}
                        <div className="m-product-hero">
                            {productInfo.images && productInfo.images.length > 0 ? (
                                <img
                                    src={getImageSrc(productInfo.images[0])}
                                    alt={productInfo.sku_name || ''}
                                    className="m-product-hero-img"
                                />
                            ) : (
                                <div className="m-product-hero-img placeholder"/>
                            )}
                            <div className="m-product-hero-body">
                                <div style={{flex: 1, minWidth: 0}}>
                                    <div className="m-product-hero-title">
                                        {productInfo.sku_name}
                                    </div>
                                    <div className="m-product-hero-article">
                                        {t.article}: {productInfo.article}
                                    </div>
                                </div>
                                {productInfo.price && (
                                    <div className="m-product-hero-price">
                                        {productInfo.price} ₾
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Warehouse Sections */}
                        {(() => {
                            const userWarehouseNames = userWarehouses.map((w) => w.name);
                            const hasUserWarehouses = userWarehouseNames.length > 0;
                            if (!hasUserWarehouses) {
                                return (
                                    <div className="m-balance-section">
                                        <div className="m-balance-list">
                                            {balances.map((item) => renderWarehouseRow(item, false))}
                                        </div>
                                    </div>
                                );
                            }
                            const mine = balances.filter((b) => userWarehouseNames.includes(b.warehouse_name));
                            const others = balances.filter((b) => !userWarehouseNames.includes(b.warehouse_name));
                            return (
                                <div className="m-balance-section">
                                    {renderWarehouseSection(mine, true)}
                                    {renderWarehouseSection(others, false)}
                                </div>
                            );
                        })()}

                        {!searchedAllWarehouses && userWarehouses.length > 0 && lastSearchRef.current && (
                            <Button
                                type="default"
                                size="large"
                                icon={<AppstoreOutlined/>}
                                onClick={handleShowOtherWarehouses}
                                loading={loading}
                                block
                                className="m-show-other-warehouses-btn"
                            >
                                {t.seeAllWarehouses}
                            </Button>
                        )}
                    </div>
                </Spin>
            )}
```

Note: this drops the `Carousel` import usage and the multi-image rendering. The `Carousel` import can stay in the import list (no harm done) — leave the existing imports unchanged.

- [ ] **Step 5: Smoke test the product results**

Run: `cd barcode-scanner-frontend && npm start`

Sign in and:
- Scan or search for a product known to be in stock at one of your warehouses. Confirm:
  - The product hero shows a wide image at the top, with the name + `Article: <code>` on the left and the price on the right.
  - The "⭐ My warehouses" section appears with your warehouse highlighted (light blue card).
  - Each row shows the warehouse name, price, color-coded quantity number, and a stock-meter bar (green for plenty, amber for ≤5).
  - Scan a product that's only in someone else's warehouse: confirm the "🏬 Other warehouses" section appears (after toggling all-warehouses or pressing "+ See all warehouses").
  - Toggle "all warehouses" on, scan again: confirm both sections appear.
- Toggle dark mode: confirm the new classes render legibly.

Stop the dev server with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js
git commit -m "$(cat <<'EOF'
feat(dashboard): refactor product results into hero + section layout

Replaces the stacked product card + flat balance list with a wide
product hero (image + name + price chip) and two warehouse sections:
'My warehouses' (highlighted) and 'Other warehouses'. Each row shows
a color-coded quantity number and a stock-meter bar (green / amber /
empty). 'Show other warehouses' becomes 'See all warehouses'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: End-to-end smoke test

**Files:** None (manual verification).

- [ ] **Step 1: Start the full stack**

Run: `docker-compose up --build -d`

Wait until both services are healthy. Open `http://localhost:3000`.

- [ ] **Step 2: Verify empty state from a fresh login**

Sign in as a `company_user`. The product page should show:
- Time-appropriate greeting + username
- "Scans today: 0" (no meta line) and "Orders today: 0" (no meta line)
- Recent scans card with "No scans yet today" Empty

If counts are non-zero from a previous session, that's fine — the test is that they render.

- [ ] **Step 3: Verify scan recording**

Tap Scan in the bottom bar (or use the search drawer) and search for a known-good barcode. Confirm:
- Found sound plays.
- Page transitions to product results.
- Tap the bottom-bar "Product" tab again, then trigger a "fresh state" by performing a not-found search, then scrolling back: the empty state should now show "Scans today: 1 (1 found · 0 not found)" or similar.

(Easier alternative: open DevTools → Application → Local Storage → `barcode-scanner.scanLog` and confirm an entry was written.)

Now perform a search you know will fail (`PRODUCT_NOT_FOUND`). Confirm:
- Not-found sound plays.
- The localStorage entry has `found: false`.
- Returning to the empty state shows the failed scan as a red-thumb row in Recent scans, with "Not found" meta.

- [ ] **Step 4: Verify tap-to-research**

In the empty state's Recent scans list, tap a row with a successful scan. Confirm:
- The same product loads on the right (product results view).

Tap a not-found row. Confirm:
- The not-found notification fires.

- [ ] **Step 5: Verify warehouse sections + meter**

Search for a product in stock. Confirm:
- "⭐ My warehouses" header + count tag appears, with the user's warehouse(s) listed in highlighted cards.
- Each card shows the price, the color-coded quantity number (green/amber/gray), and a stock meter underneath.
- Tap "+ See all warehouses". Confirm "🏬 Other warehouses" section appears with non-user warehouses.

- [ ] **Step 6: Verify orders today bumps**

Create a draft order. Confirm "Orders today" jumps from N to N+1 in the empty state's KPI card. Confirm the ₾ meta line on the green card stays the same (drafts don't contribute).

Confirm the draft. Re-visit the empty state. Confirm the ₾ meta line increases by the order total.

- [ ] **Step 7: Verify dark mode**

Toggle dark mode in the user menu. Confirm:
- Greeting + KPI cards use the dark gradient backgrounds.
- Recent-scan rows have legible text.
- Product hero card is dark.
- Stock-meter track is visible against the dark background.

- [ ] **Step 8: Stop the stack and finish**

Run: `docker-compose down`

If everything works, the work is complete. If anything is broken, fix it inline and add a commit.

---

## Spec coverage check

| Spec section | Covered by |
|---|---|
| Empty state shown when balances empty + scanner closed | Task 7, step 5 |
| Greeting + subtitle | Task 6 (component), Task 7 (wires `username`) |
| Two KPI cards (Scans today, Orders today) | Task 6 (markup), Task 4 (data), Task 5 (CSS) |
| `Scans today` found/not-found split | Task 6 (`scansSummary.foundCount`/`notFoundCount`) |
| `Orders today` count + ₾ total (confirmed only) | Task 4 (`ordersSummary.total` filters `status === 'confirmed'`) |
| Recent scans list (≤3) | Task 4 (`recentScans.slice(0, 3)`), Task 6 (markup) |
| Tap recent → re-search | Task 7 step 4 (`handleResearchFromHistory`) |
| Empty Recent state | Task 6 (`<Empty/>` branch) |
| Removes duplicate scan/search buttons | Task 7 step 5 (replaces the JSX block entirely) |
| Order indicator bar unchanged | Untouched |
| Product hero card | Task 8 step 4 (`.m-product-hero` JSX) |
| My / Other warehouse sections | Task 8 step 3 (`renderWarehouseSection`) |
| Section omitted when empty | `if (items.length === 0) return null` |
| No partitioning when user has 0 warehouses | Task 8 step 4 (the `!hasUserWarehouses` branch) |
| Color-coded qty number | Task 8 step 2 (`qtyClass`) |
| Stock meter | Task 8 step 2 (`m-stock-meter`) |
| LOW_STOCK_THRESHOLD = 5, MAX_STOCK_FOR_FULL_BAR = 15 | Task 8 step 1 |
| Low-stock label | Task 8 step 2 (`m-low-stock-label`) |
| "+ See all warehouses" wording | Task 8 step 4 (uses `t.seeAllWarehouses`) |
| localStorage scan log | Task 1 |
| Skip recording on `EXTERNAL_SERVICE_*` | Task 7 step 3 (`if (!isExternalServiceError)`) |
| `refresh()` after scan and after order confirm | Task 7 steps 3, 6 |
| New CSS classes + dark mode | Task 5 |
| New translation keys (ka + en) | Task 3 |
| Single image used (drop carousel) | Task 8 step 4 (`productInfo.images[0]`) |

All spec items are covered.

## Out of scope (per spec)

- Backend `ScanLog` model.
- Camera scanner / library changes.
- OrderPanel, search drawer, bottom bar, scanner overlay, cart FAB rework.
- API-side image inlining performance.

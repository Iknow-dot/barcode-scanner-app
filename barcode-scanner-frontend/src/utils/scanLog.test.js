import {recordScan, getTodayScans, getTodaySummary} from './scanLog';

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

    describe('day scoping (getTodayScans)', () => {
        it('excludes entries from yesterday', () => {
            const yesterday = Date.now() - 25 * 60 * 60 * 1000;
            // Write directly to bypass recordScan's calendar-day pruning so we
            // can prove getTodayScans filters by isSameDay on read.
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify([
                mkScan({search: 'new'}),
                mkScan({search: 'old', scanned_at: yesterday}),
            ]));
            const scans = getTodayScans();
            expect(scans).toHaveLength(1);
            expect(scans[0].search).toBe('new');
        });

        it('summary counts only today', () => {
            const yesterday = Date.now() - 25 * 60 * 60 * 1000;
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify([
                mkScan({scanned_at: yesterday, found: true}),
                mkScan({found: true}),
                mkScan({found: false}),
            ]));
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

        it('drops non-today entries on write', () => {
            const yesterday = Date.now() - 25 * 60 * 60 * 1000;
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify([
                mkScan({search: 'yesterday', scanned_at: yesterday}),
            ]));
            recordScan(mkScan({search: 'today'}));
            const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
            expect(raw).toHaveLength(1);
            expect(raw[0].search).toBe('today');
        });
    });

    describe('storage failures', () => {
        it('does not throw when localStorage.setItem fails', () => {
            const original = window.localStorage.setItem;
            window.localStorage.setItem = () => { throw new Error('quota exceeded'); };
            try {
                expect(() => recordScan(mkScan())).not.toThrow();
            } finally {
                window.localStorage.setItem = original;
            }
        });
    });
});

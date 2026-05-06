const STORAGE_KEY = 'barcode-scanner.scanLog';
const MAX_ENTRIES = 50;

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
        .filter((e) => isSameDay(e.scanned_at))
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

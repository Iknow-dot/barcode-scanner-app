import formatRelativeTime from './formatRelativeTime';

const t = {
    justNow: 'just now',
    minAgo: (n) => `${n} min ago`,
    hoursAgo: (n) => `${n}h ago`,
};

const tWithLong = {
    ...t,
    dayAgo: 'yesterday',
    daysAgo: (n) => `${n} days ago`,
    weeksAgo: (n) => `${n} weeks ago`,
    monthAgo: 'a month ago',
    monthsAgo: (n) => `${n} months ago`,
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

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
        expect(formatRelativeTime(now - HOUR, t)).toBe('1h ago');
        expect(formatRelativeTime(now - 5 * HOUR, t)).toBe('5h ago');
    });

    it('falls back to a localized date for ≥ 24h when long-form keys are absent', () => {
        const old = now - 2 * DAY;
        expect(formatRelativeTime(old, t)).toBe(new Date(old).toLocaleDateString());
    });

    it('uses dayAgo for ~1 day', () => {
        expect(formatRelativeTime(now - 25 * HOUR, tWithLong)).toBe('yesterday');
    });

    it('uses daysAgo for 2–6 days', () => {
        expect(formatRelativeTime(now - 3 * DAY, tWithLong)).toBe('3 days ago');
        expect(formatRelativeTime(now - 6 * DAY, tWithLong)).toBe('6 days ago');
    });

    it('uses weeksAgo for 1–4 weeks', () => {
        expect(formatRelativeTime(now - 9 * DAY, tWithLong)).toBe('1 weeks ago');
        expect(formatRelativeTime(now - 21 * DAY, tWithLong)).toBe('3 weeks ago');
    });

    it('uses monthAgo for ~1 month', () => {
        expect(formatRelativeTime(now - 35 * DAY, tWithLong)).toBe('a month ago');
    });

    it('uses monthsAgo for 2–11 months', () => {
        expect(formatRelativeTime(now - 90 * DAY, tWithLong)).toBe('3 months ago');
    });

    it('falls back to a localized date past a year', () => {
        const old = now - 400 * DAY;
        expect(formatRelativeTime(old, tWithLong)).toBe(new Date(old).toLocaleDateString());
    });
});

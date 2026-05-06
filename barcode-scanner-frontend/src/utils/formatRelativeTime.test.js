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

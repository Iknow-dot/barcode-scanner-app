const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

const formatRelativeTime = (ms, t) => {
    const delta = Date.now() - ms;
    if (delta < MIN) return t.justNow;
    if (delta < HOUR) return t.minAgo(Math.floor(delta / MIN));
    if (delta < DAY) return t.hoursAgo(Math.floor(delta / HOUR));
    // The day/week/month strings exist so the admin "last login" column can
    // stay in the relative format past 24h instead of falling back to the
    // dayjs ka locale (which produces awkward Georgian phrasing).
    if (delta < 2 * DAY && t.dayAgo) return t.dayAgo;
    if (delta < WEEK && t.daysAgo) return t.daysAgo(Math.floor(delta / DAY));
    if (delta < MONTH && t.weeksAgo) return t.weeksAgo(Math.floor(delta / WEEK));
    if (delta < 2 * MONTH && t.monthAgo) return t.monthAgo;
    if (delta < 12 * MONTH && t.monthsAgo) return t.monthsAgo(Math.floor(delta / MONTH));
    return new Date(ms).toLocaleDateString();
};

export default formatRelativeTime;

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

// Formats a 0..1 conversion rate as a whole-number percent string, e.g. 0.583 -> "58%".
const formatConversionRate = (rate) => {
    const n = Number(rate);
    if (!Number.isFinite(n)) return '0%';
    return `${Math.round(n * 100)}%`;
};

export default formatConversionRate;

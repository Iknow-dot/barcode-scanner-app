/**
 * Pure helpers over the invoice layout the backend validates in
 * core/services/invoice_layout.py. None of them mutate their input.
 */

export const BRANDING_KEYS = [
    'invoice_logo',
    'invoice_display_name',
    'invoice_address',
    'invoice_phone',
    'invoice_email',
    'invoice_footer_text',
];

/** The backend rejects a layout with more than this many text blocks. */
export const MAX_TEXT_BLOCKS = 20;

const BLOCK_TITLE_KEYS = {
    header: 'blockHeader',
    parties: 'blockParties',
    items: 'blockItems',
    totals: 'blockTotals',
    text: 'blockText',
    footer: 'blockFooter',
};

let counter = 0;

/** A block id the backend accepts (^[a-z0-9-]{1,32}$). */
export const newBlockId = () => {
    counter += 1;
    return `t-${Date.now().toString(36)}-${counter.toString(36)}`;
};

const withBlocks = (layout, blocks) => ({...layout, blocks});

const move = (list, index, delta) => {
    const target = index + delta;
    if (index < 0 || target < 0 || target >= list.length) return list;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
};

export const moveBlock = (layout, id, delta) =>
    withBlocks(layout, move(layout.blocks, layout.blocks.findIndex(b => b.id === id), delta));

export const updateBlock = (layout, id, patch) =>
    withBlocks(layout, layout.blocks.map(b => (b.id === id ? {...b, ...patch} : b)));

export const toggleBlockHidden = (layout, id) => {
    const block = layout.blocks.find(b => b.id === id);
    return block ? updateBlock(layout, id, {hidden: !block.hidden}) : layout;
};

export const addTextBlock = (layout, afterId) => {
    const id = newBlockId();
    const block = {id, type: 'text', hidden: false, html: ''};
    const index = afterId ? layout.blocks.findIndex(b => b.id === afterId) : -1;
    const blocks = [...layout.blocks];
    blocks.splice(index >= 0 ? index + 1 : blocks.length, 0, block);
    return {layout: withBlocks(layout, blocks), id};
};

export const removeBlock = (layout, id) =>
    withBlocks(layout, layout.blocks.filter(b => !(b.id === id && b.type === 'text')));

export const updatePage = (layout, patch) => ({...layout, page: {...layout.page, ...patch}});

export const moveEntry = (entries, key, delta) => move(entries, entries.findIndex(e => e.key === key), delta);

export const updateEntry = (entries, key, patch) => entries.map(e => (e.key === key ? {...e, ...patch} : e));

/**
 * `JSON.stringify` on an object depends on key order, and Postgres jsonb
 * returns keys reordered — so a layout round-tripped through the backend can
 * look "dirty" even though nothing changed. Sort object keys (arrays keep
 * their order, since order is meaningful there) before comparing.
 */
const stableStringify = (value) => {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
};

export const isDirty = (current, saved) =>
    stableStringify(current.layout) !== stableStringify(saved.layout)
    || BRANDING_KEYS.some(key => (current.branding[key] || '') !== (saved.branding[key] || ''));

/** Only the branding keys whose value actually changed from `saved`, for a
 * cheap preview payload (skips re-uploading e.g. an unchanged logo). */
export const changedBranding = (current, saved) => Object.fromEntries(
    BRANDING_KEYS.filter(key => (current[key] || '') !== (saved[key] || '')).map(key => [key, current[key]]),
);

const plainText = html => {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    return (div.textContent || '').replace(/\s+/g, ' ').trim();
};

export const blockTitle = (block, t) => {
    const title = t[BLOCK_TITLE_KEYS[block.type]] || block.type;
    if (block.type !== 'text') return title;
    const words = plainText(block.html).split(' ').filter(Boolean);
    if (!words.length) return title;
    const preview = words.slice(0, 4).join(' ');
    return `${title}: ${preview}${words.length > 4 ? '…' : ''}`;
};

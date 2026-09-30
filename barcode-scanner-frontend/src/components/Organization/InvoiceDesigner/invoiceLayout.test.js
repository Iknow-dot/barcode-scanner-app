import {
    addTextBlock, blockTitle, isDirty, moveBlock, moveEntry, newBlockId,
    removeBlock, toggleBlockHidden, updateBlock, updateEntry, updatePage,
} from './invoiceLayout';

const LAYOUT = {
    version: 1,
    page: {accent: '#3A9866', variant: 'glass', title: 'INVOICE'},
    blocks: [
        {id: 'header', type: 'header', hidden: false},
        {id: 'items', type: 'items', hidden: false, columns: [
            {key: 'sku', hidden: false, label: 'SKU'},
            {key: 'price', hidden: false, label: 'Price'},
        ]},
        {id: 'footer', type: 'footer', hidden: false},
    ],
};
const ids = layout => layout.blocks.map(b => b.id);

describe('invoiceLayout helpers', () => {
    it('newBlockId matches the backend id pattern and is unique', () => {
        const a = newBlockId();
        expect(a).toMatch(/^[a-z0-9-]{1,32}$/);
        expect(newBlockId()).not.toBe(a);
    });

    it('moveBlock moves and clamps at the ends', () => {
        expect(ids(moveBlock(LAYOUT, 'items', -1))).toEqual(['items', 'header', 'footer']);
        expect(ids(moveBlock(LAYOUT, 'header', -1))).toEqual(['header', 'items', 'footer']);
        expect(ids(moveBlock(LAYOUT, 'footer', 1))).toEqual(['header', 'items', 'footer']);
        expect(ids(LAYOUT)).toEqual(['header', 'items', 'footer']);
    });

    it('toggleBlockHidden flips only that block', () => {
        const next = toggleBlockHidden(LAYOUT, 'items');
        expect(next.blocks[1].hidden).toBe(true);
        expect(LAYOUT.blocks[1].hidden).toBe(false);
    });

    it('addTextBlock inserts after the given block, or at the end', () => {
        const {layout, id} = addTextBlock(LAYOUT, 'header');
        expect(ids(layout)).toEqual(['header', id, 'items', 'footer']);
        expect(layout.blocks[1]).toEqual({id, type: 'text', hidden: false, html: ''});
        expect(ids(addTextBlock(LAYOUT, null).layout).slice(-1)[0]).toMatch(/^t-/);
    });

    it('removeBlock only removes text blocks', () => {
        const {layout, id} = addTextBlock(LAYOUT, null);
        expect(ids(removeBlock(layout, id))).toEqual(['header', 'items', 'footer']);
        expect(ids(removeBlock(LAYOUT, 'items'))).toEqual(['header', 'items', 'footer']);
    });

    it('updateBlock and updatePage merge a patch', () => {
        expect(updateBlock(LAYOUT, 'header', {show_logo: false}).blocks[0].show_logo).toBe(false);
        expect(updatePage(LAYOUT, {accent: '#FF3B30'}).page).toEqual(
            {accent: '#FF3B30', variant: 'glass', title: 'INVOICE'});
    });

    it('moveEntry and updateEntry work on columns by key', () => {
        const cols = LAYOUT.blocks[1].columns;
        expect(moveEntry(cols, 'price', -1).map(c => c.key)).toEqual(['price', 'sku']);
        expect(updateEntry(cols, 'sku', {hidden: true})[0]).toEqual({key: 'sku', hidden: true, label: 'SKU'});
        expect(cols[0].hidden).toBe(false);
    });

    it('isDirty compares layout and branding', () => {
        const saved = {layout: LAYOUT, branding: {invoice_phone: '1'}};
        expect(isDirty({layout: LAYOUT, branding: {invoice_phone: '1'}}, saved)).toBe(false);
        expect(isDirty({layout: updatePage(LAYOUT, {title: 'X'}), branding: {invoice_phone: '1'}}, saved)).toBe(true);
        expect(isDirty({layout: LAYOUT, branding: {invoice_phone: '2'}}, saved)).toBe(true);
    });

    it('blockTitle uses the translation, and a text block shows its first words', () => {
        const t = {blockItems: 'Items table', blockText: 'Text'};
        expect(blockTitle({type: 'items'}, t)).toBe('Items table');
        expect(blockTitle({type: 'text', html: '<p>Payment within <b>5</b> days of delivery</p>'}, t))
            .toBe('Text: Payment within 5 days…');
        expect(blockTitle({type: 'text', html: ''}, t)).toBe('Text');
    });
});

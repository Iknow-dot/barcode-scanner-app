import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {LanguageProvider} from '../../../i18n/LanguageContext';
import translations from '../../../i18n/translations';
import BlockList from './BlockList';
import BlockInspector from './inspectors';

jest.mock('./inspectors/TextInspector', () => ({block}) => (
    <div data-testid="text-inspector">{block.id}:{block.html}</div>
));

const t = translations.en;

beforeAll(() => {
    window.matchMedia = window.matchMedia || (query => ({
        matches: false, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }));
    global.ResizeObserver = global.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
    global.MessageChannel = global.MessageChannel || class {
        constructor() {
            this.port1 = {onmessage: null, close() {}};
            this.port2 = {
                postMessage: data => setTimeout(() => this.port1.onmessage && this.port1.onmessage({data}), 0),
                close() {},
            };
        }
    };
});
beforeEach(() => localStorage.setItem('language', 'en'));

const wrap = ui => render(<LanguageProvider>{ui}</LanguageProvider>);

const LAYOUT = {
    version: 1,
    page: {accent: '#3A9866', variant: 'glass', title: 'INVOICE'},
    blocks: [
        {id: 'header', type: 'header', hidden: false, show_logo: true, show_identification_number: true, show_contacts: true},
        {id: 'items', type: 'items', hidden: false, columns: [
            {key: 'sku', hidden: false, label: 'SKU'},
            {key: 'price', hidden: false, label: 'Price'},
        ]},
        {id: 't1', type: 'text', hidden: false, html: '<p>Pay soon</p>'},
    ],
};

describe('BlockList', () => {
    it('selects, hides, moves and deletes blocks', () => {
        const onSelect = jest.fn();
        const onChange = jest.fn();
        wrap(<BlockList layout={LAYOUT} selectedId="header" onSelect={onSelect} onChange={onChange} onAddText={jest.fn()} />);

        fireEvent.click(screen.getByText(t.blockItems));
        expect(onSelect).toHaveBeenCalledWith('items');

        fireEvent.click(screen.getAllByLabelText(t.hideBlock)[1]);
        expect(onChange.mock.calls[0][0].blocks[1].hidden).toBe(true);

        fireEvent.click(screen.getAllByLabelText(t.moveUp)[1]);
        expect(onChange.mock.calls[1][0].blocks.map(b => b.id)).toEqual(['items', 'header', 't1']);

        // Only the text block can be deleted.
        expect(screen.getAllByLabelText(t.deleteBlock)).toHaveLength(1);
        fireEvent.click(screen.getByLabelText(t.deleteBlock));
        expect(onChange.mock.calls[2][0].blocks.map(b => b.id)).toEqual(['header', 'items']);
    });

    it('selects a row with Enter or Space (keyboard access)', () => {
        const onSelect = jest.fn();
        wrap(<BlockList layout={LAYOUT} selectedId="header" onSelect={onSelect} onChange={jest.fn()} onAddText={jest.fn()} />);
        const row = screen.getByText(t.blockItems).closest('[role="button"]');
        expect(row).toHaveAttribute('tabIndex', '0');
        fireEvent.keyDown(row, {key: 'Enter'});
        expect(onSelect).toHaveBeenCalledWith('items');
        fireEvent.keyDown(row, {key: ' '});
        expect(onSelect).toHaveBeenCalledTimes(2);
    });

    it('disables "Add text block" once the layout has 20 text blocks', () => {
        const layout = {
            ...LAYOUT,
            blocks: [
                LAYOUT.blocks[0],
                LAYOUT.blocks[1],
                ...Array.from({length: 20}, (_, i) => ({id: `t${i}`, type: 'text', hidden: false, html: ''})),
            ],
        };
        wrap(<BlockList layout={layout} selectedId="header" onSelect={jest.fn()} onChange={jest.fn()} onAddText={jest.fn()} />);
        expect(screen.getByText(t.addTextBlock).closest('button')).toBeDisabled();
    });
});

describe('BlockInspector', () => {
    it('edits item columns', () => {
        const onBlockChange = jest.fn();
        wrap(<BlockInspector block={LAYOUT.blocks[1]} branding={{}} tokens={{org: [], order: []}}
                             onBlockChange={onBlockChange} onBrandingChange={jest.fn()} />);
        fireEvent.change(screen.getByDisplayValue('Price'), {target: {value: 'Unit price'}});
        expect(onBlockChange).toHaveBeenLastCalledWith({columns: [
            {key: 'sku', hidden: false, label: 'SKU'},
            {key: 'price', hidden: false, label: 'Unit price'},
        ]});
    });

    it('header edits go to branding, toggles go to the block', () => {
        const onBlockChange = jest.fn();
        const onBrandingChange = jest.fn();
        wrap(<BlockInspector block={LAYOUT.blocks[0]} branding={{invoice_display_name: 'Acme'}}
                             tokens={{org: [], order: []}}
                             onBlockChange={onBlockChange} onBrandingChange={onBrandingChange} />);
        fireEvent.change(screen.getByDisplayValue('Acme'), {target: {value: 'Acme LLC'}});
        expect(onBrandingChange).toHaveBeenLastCalledWith({invoice_display_name: 'Acme LLC'});
        fireEvent.click(screen.getByRole('switch', {name: t.showLogo}));
        expect(onBlockChange).toHaveBeenLastCalledWith({show_logo: false});
        // The header inspector owns the header branding fields only — the
        // footer text belongs to FooterInspector.
        expect(screen.queryByText(t.invoiceFooterText)).not.toBeInTheDocument();
    });

    it('the footer inspector shows only the footer text, not the header fields', () => {
        wrap(<BlockInspector block={{id: 'footer', type: 'footer', hidden: false}}
                             branding={{invoice_display_name: 'Acme', invoice_footer_text: 'Thanks'}}
                             tokens={{org: [], order: []}} onBlockChange={jest.fn()} onBrandingChange={jest.fn()} />);
        expect(screen.getByDisplayValue('Thanks')).toBeInTheDocument();
        expect(screen.queryByText(t.invoiceDisplayName)).not.toBeInTheDocument();
        expect(screen.queryByText(t.invoiceLogo)).not.toBeInTheDocument();
    });

    it('remounts the text editor when the selected text block changes', () => {
        const props = {branding: {}, tokens: {org: [], order: []}, onBlockChange: jest.fn(), onBrandingChange: jest.fn()};
        const {rerender} = wrap(<BlockInspector block={LAYOUT.blocks[2]} {...props} />);
        expect(screen.getByTestId('text-inspector')).toHaveTextContent('t1:<p>Pay soon</p>');
        rerender(<LanguageProvider><BlockInspector block={{id: 't2', type: 'text', hidden: false, html: '<p>B</p>'}} {...props} /></LanguageProvider>);
        expect(screen.getByTestId('text-inspector')).toHaveTextContent('t2:<p>B</p>');
    });

    it('asks for a selection when no block is selected', () => {
        wrap(<BlockInspector block={null} branding={{}} tokens={{org: [], order: []}}
                             onBlockChange={jest.fn()} onBrandingChange={jest.fn()} />);
        expect(screen.getByText(t.selectBlockHint)).toBeInTheDocument();
    });
});

import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {LanguageProvider} from '../../../i18n/LanguageContext';
import translations from '../../../i18n/translations';
import InvoiceDesigner from './InvoiceDesigner';

jest.mock('../../../api', () => ({
    organizationService: {getInvoiceTemplate: jest.fn(), updateInvoiceTemplate: jest.fn()},
    invoiceTokenService: {fetchCatalogAndDefault: jest.fn()},
    orderService: {getOrders: jest.fn()},
}));
jest.mock('./InvoiceCanvas', () => ({onSelectBlock, legacyHtml}) => (
    <div>
        <span data-testid="canvas-mode">{legacyHtml !== null ? 'legacy' : 'layout'}</span>
        <button type="button" onClick={() => onSelectBlock('items')}>canvas-click-items</button>
    </div>
));
jest.mock('./inspectors/TextInspector', () => () => <div />);

const {organizationService, invoiceTokenService, orderService} = require('../../../api');
const t = translations.en;

const DEFAULT_LAYOUT = {
    version: 1,
    page: {accent: '#3A9866', variant: 'glass', title: 'INVOICE'},
    blocks: [
        {id: 'header', type: 'header', hidden: false, show_logo: true, show_identification_number: true, show_contacts: true},
        {id: 'items', type: 'items', hidden: false, columns: [{key: 'sku', hidden: false, label: 'SKU'}]},
        {id: 'totals', type: 'totals', hidden: false, label: 'Total'},
    ],
};
const SETTINGS = {
    invoice_logo: '', invoice_display_name: 'Acme', invoice_address: '', invoice_phone: '',
    invoice_email: '', invoice_footer_text: '', invoice_template_html: '', invoice_layout: {},
};

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

beforeEach(() => {
    localStorage.setItem('language', 'en');
    jest.clearAllMocks();
    invoiceTokenService.fetchCatalogAndDefault.mockResolvedValue({
        success: true, data: {tokens: {org: [], order: [], item: []}, default_layout: DEFAULT_LAYOUT},
    });
    orderService.getOrders.mockResolvedValue({success: true, data: {results: [{id: 42, customer_name: 'Nino'}]}});
    organizationService.updateInvoiceTemplate.mockResolvedValue({success: true, data: {}});
});

const renderDesigner = async (settings = SETTINGS) => {
    organizationService.getInvoiceTemplate.mockResolvedValue({success: true, data: settings});
    render(<LanguageProvider><InvoiceDesigner /></LanguageProvider>);
    // Present in both legacy and layout mode (the block panes are not, in
    // legacy mode); tests that need the block list await it themselves.
    await screen.findByText(t.invoiceDesigner);
};

describe('InvoiceDesigner', () => {
    it('starts from the default layout and opens the inspector of a listed block', async () => {
        await renderDesigner();
        await screen.findByText(t.blocks);
        fireEvent.click(screen.getByText(t.blockItems));
        expect(screen.getByText(t.columnsLabel)).toBeInTheDocument();
    }, 30000);

    it('selects the block clicked on the canvas', async () => {
        await renderDesigner();
        fireEvent.click(screen.getByText('canvas-click-items'));
        expect(screen.getByText(t.columnsLabel)).toBeInTheDocument();
    }, 30000);

    it('shows the legacy banner and switches to the designer on request', async () => {
        await renderDesigner({...SETTINGS, invoice_template_html: '<p>old</p>'});
        expect(screen.getByText(t.legacyTemplateBanner)).toBeInTheDocument();
        expect(screen.getByTestId('canvas-mode')).toHaveTextContent('legacy');
        fireEvent.click(screen.getByText(t.switchToDesigner));
        expect(screen.getByTestId('canvas-mode')).toHaveTextContent('layout');
        expect(screen.getByLabelText(t.unsavedChanges)).toBeInTheDocument();
    }, 30000);

    it('lets a legacy org edit branding and saves it without switching off the legacy template', async () => {
        await renderDesigner({...SETTINGS, invoice_template_html: '<p>old</p>'});
        expect(screen.getByTestId('canvas-mode')).toHaveTextContent('legacy');
        // Legacy mode has no per-block inspectors, so it renders every
        // branding field in one place — header fields and the footer text.
        expect(screen.getByText(t.invoiceDisplayName)).toBeInTheDocument();
        expect(screen.getByText(t.invoiceFooterText)).toBeInTheDocument();
        const nameInput = screen.getByDisplayValue('Acme');
        fireEvent.change(nameInput, {target: {value: 'Acme LLC'}});
        expect(screen.getByLabelText(t.unsavedChanges)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: /save/i}));
        await waitFor(() => expect(organizationService.updateInvoiceTemplate).toHaveBeenCalledTimes(1));
        const payload = organizationService.updateInvoiceTemplate.mock.calls[0][0];
        expect(payload.invoice_display_name).toBe('Acme LLC');
        expect(payload).not.toHaveProperty('invoice_layout');
        await waitFor(() => expect(screen.queryByLabelText(t.unsavedChanges)).not.toBeInTheDocument());
        // Still on the legacy template — the save didn't switch it over.
        expect(screen.getByTestId('canvas-mode')).toHaveTextContent('legacy');
    }, 30000);

    it('saves layout and branding in one call and clears the unsaved dot', async () => {
        await renderDesigner();
        await screen.findByText(t.blocks);
        fireEvent.click(screen.getByText(t.blockHeader));
        fireEvent.change(screen.getByDisplayValue('Acme'), {target: {value: 'Acme LLC'}});
        expect(screen.getByLabelText(t.unsavedChanges)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: /save/i}));
        await waitFor(() => expect(organizationService.updateInvoiceTemplate).toHaveBeenCalledTimes(1));
        const payload = organizationService.updateInvoiceTemplate.mock.calls[0][0];
        expect(payload.invoice_display_name).toBe('Acme LLC');
        expect(payload.invoice_layout).toEqual(DEFAULT_LAYOUT);
        await waitFor(() => expect(screen.queryByLabelText(t.unsavedChanges)).not.toBeInTheDocument());
    }, 30000);

    it('selects the offending block when the save is rejected', async () => {
        organizationService.updateInvoiceTemplate.mockResolvedValue({
            success: false, error: 'bad',
            data: {invoice_layout: {code: 'INVOICE_LAYOUT_INVALID', detail: 'bad', block_id: 'totals'}},
        });
        await renderDesigner();
        await screen.findByText(t.blocks);
        fireEvent.click(screen.getByText(t.blockHeader));
        fireEvent.change(screen.getByDisplayValue('Acme'), {target: {value: 'X'}});
        fireEvent.click(screen.getByRole('button', {name: /save/i}));
        expect(await screen.findByText(t.totalsLabelField)).toBeInTheDocument();
    }, 30000);

    it('guards navigation with beforeunload while dirty, and stops once saved', async () => {
        await renderDesigner();
        await screen.findByText(t.blocks);
        fireEvent.click(screen.getByText(t.blockHeader));
        fireEvent.change(screen.getByDisplayValue('Acme'), {target: {value: 'Acme LLC'}});
        expect(screen.getByLabelText(t.unsavedChanges)).toBeInTheDocument();

        const dirtyEvent = new Event('beforeunload', {cancelable: true});
        window.dispatchEvent(dirtyEvent);
        expect(dirtyEvent.defaultPrevented).toBe(true);

        fireEvent.click(screen.getByRole('button', {name: /save/i}));
        await waitFor(() => expect(screen.queryByLabelText(t.unsavedChanges)).not.toBeInTheDocument());

        const cleanEvent = new Event('beforeunload', {cancelable: true});
        window.dispatchEvent(cleanEvent);
        expect(cleanEvent.defaultPrevented).toBe(false);
    }, 30000);
});

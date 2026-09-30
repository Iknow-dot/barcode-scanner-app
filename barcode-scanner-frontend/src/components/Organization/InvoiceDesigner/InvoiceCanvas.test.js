import React from 'react';
import {render, screen, waitFor} from '@testing-library/react';
import {LanguageProvider} from '../../../i18n/LanguageContext';
import translations from '../../../i18n/translations';
import InvoiceCanvas from './InvoiceCanvas';

jest.mock('../../../api', () => ({
    orderService: {fetchInvoiceLayoutPreviewHtml: jest.fn(), fetchInvoicePreviewHtml: jest.fn()},
}));

const {orderService} = require('../../../api');
const t = translations.en;

beforeEach(() => {
    localStorage.setItem('language', 'en');
    jest.clearAllMocks();
    window.URL.createObjectURL = jest.fn(() => 'blob:mock');
    window.URL.revokeObjectURL = jest.fn();
});

const wrap = ui => render(<LanguageProvider>{ui}</LanguageProvider>);

describe('InvoiceCanvas', () => {
    it('says orders could not load, not "create an order", when getOrders failed', () => {
        wrap(<InvoiceCanvas orderId={null} layout={null} branding={{}} legacyHtml={null}
                            selectedBlockId={null} onSelectBlock={jest.fn()} ordersFailed />);
        expect(screen.getByText(t.previewOrdersLoadFailed)).toBeInTheDocument();
        expect(screen.queryByText(t.noOrdersForPreview)).not.toBeInTheDocument();
    });

    it('says "create an order" when there simply are no orders yet', () => {
        wrap(<InvoiceCanvas orderId={null} layout={null} branding={{}} legacyHtml={null}
                            selectedBlockId={null} onSelectBlock={jest.fn()} />);
        expect(screen.getByText(t.noOrdersForPreview)).toBeInTheDocument();
    });

    it('shows the backend detail under the generic notice on an INVOICE_LAYOUT_INVALID failure', async () => {
        const body = JSON.stringify({code: 'INVOICE_LAYOUT_INVALID', detail: 'The accent must be a #RRGGBB colour.', block_id: null});
        orderService.fetchInvoiceLayoutPreviewHtml.mockResolvedValue({
            success: false, status: 400, code: 'INVOICE_LAYOUT_INVALID', error: body, data: body,
        });
        wrap(<InvoiceCanvas orderId={7} layout={{blocks: [], page: {}}} branding={{}} legacyHtml={null}
                            selectedBlockId={null} onSelectBlock={jest.fn()} />);
        await waitFor(() => expect(screen.getByText(t.previewRefreshFailed)).toBeInTheDocument(), {timeout: 2000});
        expect(screen.getByText('The accent must be a #RRGGBB colour.')).toBeInTheDocument();
    }, 10000);

    it('flattens a field-validation error body (e.g. a half-typed invoice_email)', async () => {
        const body = JSON.stringify({invoice_email: ['Enter a valid email address.']});
        orderService.fetchInvoiceLayoutPreviewHtml.mockResolvedValue({
            success: false, status: 400, error: body, data: body,
        });
        wrap(<InvoiceCanvas orderId={7} layout={{blocks: [], page: {}}} branding={{}} legacyHtml={null}
                            selectedBlockId={null} onSelectBlock={jest.fn()} />);
        await waitFor(() => expect(screen.getByText(t.previewRefreshFailed)).toBeInTheDocument(), {timeout: 2000});
        expect(screen.getByText('invoice_email: Enter a valid email address.')).toBeInTheDocument();
    }, 10000);
});

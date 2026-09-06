import {apiRequest, extractErrorMessage, getErrorCode} from './request';

describe('apiRequest failure envelope', () => {
    const axiosError = (status, data) => ({
        message: 'Request failed',
        response: {status, data},
    });

    it('carries the response body as data so callers can read structured payloads', async () => {
        const body = {
            code: 'INSUFFICIENT_STOCK',
            detail: 'Requested quantity exceeds free stock for one or more items.',
            items: [{sku: 'S1', warehouse_code: 'W1', requested: '5', available: '3'}],
        };

        const result = await apiRequest(() => Promise.reject(axiosError(400, body)));

        expect(result.success).toBe(false);
        expect(result.code).toBe('INSUFFICIENT_STOCK');
        expect(result.status).toBe(400);
        expect(result.data).toEqual(body);
    });

    it('leaves data undefined on a network failure with no response', async () => {
        const result = await apiRequest(() => Promise.reject({message: 'Network Error'}));

        expect(result.success).toBe(false);
        expect(result.data).toBeUndefined();
    });
});

describe('extractErrorMessage', () => {
    const axiosError = (status, data) => ({message: 'Request failed', response: {status, data}});

    it('keeps the flat "field: messages" shape', () => {
        expect(extractErrorMessage(axiosError(400, {username: ['Required.', 'Too short.']})))
            .toBe('username: Required., Too short.');
    });

    it('flattens nested serializer errors instead of printing [object Object]', () => {
        const message = extractErrorMessage(axiosError(400, {
            allowed_ips: [{}, {ip_or_network: ['Invalid IP or network: office']}],
        }));
        expect(message).toBe('allowed_ips: Invalid IP or network: office');
    });

    it('renders errors on a field literally named "code" instead of swallowing them as the envelope key', () => {
        const err = axiosError(400, {code: ['Warehouse with this code already exists in this organization.']});
        expect(extractErrorMessage(err)).toBe('code: Warehouse with this code already exists in this organization.');
        expect(getErrorCode(err)).toBeNull();
    });

    it('drops the machine code from a nested {code, detail} envelope', () => {
        const message = extractErrorMessage(axiosError(400, {
            invoice_template_html: {
                code: 'INVOICE_TEMPLATE_INVALID',
                detail: 'Template may contain at most one items table.',
            },
        }));
        expect(message).toBe('invoice_template_html: Template may contain at most one items table.');
    });
});

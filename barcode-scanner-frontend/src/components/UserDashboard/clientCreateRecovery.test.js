import {
    isIndeterminateFailure,
    lookupKeyFor,
    recoverCreatedClient,
    UNVERIFIED_CODE,
} from './clientCreateRecovery';

describe('isIndeterminateFailure', () => {
    it('treats the platform router 502 as indeterminate', () => {
        // What DigitalOcean App Platform actually returns after 60s: an HTML
        // page, no JSON envelope, so getErrorCode() finds no code.
        expect(isIndeterminateFailure({
            success: false, status: 502, code: null,
            error: '<!DOCTYPE html> ... Error code: 502 ...',
        })).toBe(true);
    });

    it('treats a dropped request (no response at all) as indeterminate', () => {
        expect(isIndeterminateFailure({success: false, status: null, code: null})).toBe(true);
    });

    it('treats the backend\'s own CLIENT_CREATE_UNVERIFIED as indeterminate', () => {
        expect(isIndeterminateFailure({
            success: false, status: 504, code: UNVERIFIED_CODE,
        })).toBe(true);
    });

    it('trusts a coded envelope: the API knows the create did not land', () => {
        for (const code of [
            'EXTERNAL_SERVICE_TIMEOUT', 'EXTERNAL_SERVICE_UNAVAILABLE',
            'EXTERNAL_SERVICE_ERROR', 'CLIENT_ALREADY_EXISTS',
        ]) {
            expect(isIndeterminateFailure({success: false, status: 502, code})).toBe(false);
        }
    });

    it('does not treat a validation error as indeterminate', () => {
        expect(isIndeterminateFailure({success: false, status: 400, code: null})).toBe(false);
    });

    it('is never true for a success', () => {
        expect(isIndeterminateFailure({success: true, data: {}})).toBe(false);
    });
});

describe('lookupKeyFor', () => {
    it('prefers the identification number and falls back to the phone', () => {
        expect(lookupKeyFor({identification_number: '01001012345', phone: '555'})).toBe('01001012345');
        expect(lookupKeyFor({identification_number: '  ', phone: '555'})).toBe('555');
        expect(lookupKeyFor({})).toBe('');
    });
});

describe('recoverCreatedClient', () => {
    const payload = {identification_number: '01001012345', phone: '+995555'};
    const hit = {success: true, data: {clients: [{name: 'Giorgi Beridze'}]}};
    const miss = {success: false, code: 'CLIENT_NOT_FOUND', status: 404};

    it('returns the client when the registration had in fact landed', async () => {
        const checkClient = jest.fn().mockResolvedValue(hit);
        const result = await recoverCreatedClient(payload, checkClient);
        expect(result.found).toEqual({name: 'Giorgi Beridze'});
        expect(checkClient).toHaveBeenCalledTimes(1);
    });

    it('retries once before believing a miss — the write may still be in flight', async () => {
        const checkClient = jest.fn()
            .mockResolvedValueOnce(miss)
            .mockResolvedValueOnce(hit);
        const delay = jest.fn().mockResolvedValue();

        const result = await recoverCreatedClient(payload, checkClient, {delay});

        expect(result.found).toEqual({name: 'Giorgi Beridze'});
        expect(checkClient).toHaveBeenCalledTimes(2);
        expect(delay).toHaveBeenCalledTimes(1);
    });

    it('reports a confirmed absence separately from an unknown one', async () => {
        const confirmed = await recoverCreatedClient(
            payload, jest.fn().mockResolvedValue(miss), {delay: jest.fn().mockResolvedValue()},
        );
        expect(confirmed).toEqual({found: null, checked: true});

        const unknown = await recoverCreatedClient(
            payload,
            jest.fn().mockResolvedValue({success: false, code: 'EXTERNAL_SERVICE_TIMEOUT', status: 504}),
            {delay: jest.fn().mockResolvedValue()},
        );
        expect(unknown).toEqual({found: null, checked: false});
    });

    it('does not call the API when there is nothing to search by', async () => {
        const checkClient = jest.fn();
        const result = await recoverCreatedClient({first_name: 'A'}, checkClient);
        expect(result).toEqual({found: null, checked: false});
        expect(checkClient).not.toHaveBeenCalled();
    });
});

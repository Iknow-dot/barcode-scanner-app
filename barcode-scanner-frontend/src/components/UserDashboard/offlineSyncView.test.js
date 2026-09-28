import {attentionRowView, offlineSyncNotice} from './offlineSyncView';
import translations from '../../i18n/translations';

const en = translations.en;
const ka = translations.ka;

const SNAPSHOT = {id: 42, customer_name: 'Nino Beridze', is_retail: false, items: []};
const parked = (op, fields) => ({op: {id: 'op_1', ...op}, attempts: 1, detail: null, ...fields});

describe('attentionRowView', () => {
    test('a scan 1C never heard of: the scanned value, the quantity, why, and whose order', () => {
        const view = attentionRowView(
            parked({type: 'add_item_barcode', tempId: 'tmp_a', barcode: '4870001', quantity: 2},
                {reason: 'not_found', product: '4870001'}),
            {orderId: 42, snapshot: SNAPSHOT},
            en,
        );
        expect(view).toEqual({
            title: '4870001',
            meta: en.offlineOpAdd(2),
            reason: en.offlineReasonNotFound,
            context: `${en.orderNumber}42 · Nino Beridze`,
        });
    });

    test('a resolved scan keeps the scanned code beside the name, and a capped retry says how often it was tried', () => {
        const view = attentionRowView(
            parked({type: 'add_item_barcode', tempId: 'tmp_a', barcode: '4870001', quantity: 1},
                {reason: 'unavailable', product: 'Granite pan', attempts: 6}),
            {orderId: 42, snapshot: SNAPSHOT},
            en,
        );
        expect(view.title).toBe('Granite pan');
        expect(view.meta).toBe(`4870001 · ${en.offlineOpAdd(1)}`);
        expect(view.reason).toBe(`${en.stockUnavailable} · ${en.offlineAttempts(6)}`);
    });

    test('a rejected edit carries the server’s own words', () => {
        const view = attentionRowView(
            parked({type: 'update_item', itemId: 7, payload: {quantity: 5}},
                {reason: 'rejected', product: 'Pan', detail: 'Not found.'}),
            {orderId: 42, snapshot: SNAPSHOT},
            en,
        );
        expect(view.title).toBe('Pan');
        expect(view.meta).toBe(en.offlineOpUpdateQuantity(5));
        expect(view.reason).toBe(`${en.offlineReasonRejected}: Not found.`);
        // A terminal answer is not a count of tries.
        expect(view.reason).not.toContain(en.offlineAttempts(1));
    });

    test('each kind of change reads as what the consultant did', () => {
        const row = (op, product = null) => attentionRowView(
            parked(op, {reason: 'server_error', product, attempts: 6}), {orderId: 42, snapshot: SNAPSHOT}, en,
        );
        expect(row({type: 'update_item', itemId: 7, payload: {discount_percent: 5}}, 'Pan').meta)
            .toBe(en.offlineOpUpdateLine);
        expect(row({type: 'remove_item', itemId: 7}, 'Pan').meta).toBe(en.offlineOpRemove);
        expect(row({type: 'add_item', tempId: 'tmp_b', payload: {sku: 'S1', quantity: 3}}, 'S1').meta)
            .toBe(en.offlineOpAdd(3));
        const details = row({type: 'update_order', payload: {notes: 'x'}});
        expect(details.title).toBe(en.offlineOpOrderDetails);
        expect(details.meta).toBeNull();
        expect(row({type: 'update_item', itemId: 7, payload: {quantity: 1}}).title).toBe(en.offlineUnknownLine);
    });

    test('a retail order is named as retail, and an order with no snapshot by number alone', () => {
        const op = {type: 'update_order', payload: {notes: 'x'}};
        expect(attentionRowView(parked(op, {reason: 'rejected'}), {orderId: 9, snapshot: {is_retail: true}}, en).context)
            .toBe(`${en.orderNumber}9 · ${en.retailCustomerLabel}`);
        expect(attentionRowView(parked(op, {reason: 'rejected'}), {orderId: 9, snapshot: null}, en).context)
            .toBe(`${en.orderNumber}9`);
    });

    test('every reason has wording in both languages', () => {
        ['not_found', 'no_stock', 'rejected', 'unavailable', 'no_lookup_key', 'server_error'].forEach((reason) => {
            [en, ka].forEach((t) => {
                const view = attentionRowView(
                    parked({type: 'remove_item', itemId: 7}, {reason, product: 'Pan'}), {orderId: 1, snapshot: null}, t,
                );
                expect(typeof view.reason).toBe('string');
                expect(view.reason.length).toBeGreaterThan(0);
            });
        });
    });
});

describe('offlineSyncNotice', () => {
    const base = {synced: 0, failures: [], order: null, aborted: false, pending: 0};
    const ORDER_41 = {orderId: 41, snapshot: {...SNAPSHOT, id: 41}};
    const label = `${en.orderNumber}41 · Nino Beridze`;

    test('lines that could not be replayed are announced, even from a drain cut short', () => {
        expect(offlineSyncNotice({...base, failures: [{}, {}]}, en, ORDER_41))
            .toEqual({type: 'warning', title: en.orderError, message: en.offlineSyncFailures(2, label)});
        expect(offlineSyncNotice({...base, failures: [{}], aborted: true}, en, ORDER_41))
            .toEqual({type: 'warning', title: en.orderError, message: en.offlineSyncFailures(1, label)});
    });

    test('the toast names the order, which need not be the one on screen', () => {
        [en, ka].forEach((t) => {
            const {message} = offlineSyncNotice({...base, failures: [{}]}, t, ORDER_41);
            expect(message).toContain(`${t.orderNumber}41`);
            expect(message).toContain('Nino Beridze');
        });
    });

    test('a deleted order says so, by number, rather than pointing at a cart that is gone', () => {
        const notice = offlineSyncNotice(
            {...base, failures: [{op: null}], orderGone: true}, en, {orderId: 41, snapshot: null},
        );
        expect(notice).toEqual({type: 'warning', title: en.orderError, message: en.offlineOrderGone(`${en.orderNumber}41`)});
        expect(notice.message).toContain(`${en.orderNumber}41`);
        expect(offlineSyncNotice({...base, orderGone: true}, ka, {orderId: 41, snapshot: null}).message)
            .toContain(`${ka.orderNumber}41`);
    });

    test('"synced" only once nothing is left waiting', () => {
        expect(offlineSyncNotice({...base, synced: 2}, en, ORDER_41))
            .toEqual({type: 'success', title: en.success, message: en.offlineSynced});
        expect(offlineSyncNotice({...base, synced: 2, pending: 1}, en, ORDER_41)).toBeNull();
    });

    test('a cut-short or idle drain says nothing', () => {
        expect(offlineSyncNotice({...base, aborted: true}, en, ORDER_41)).toBeNull();
        expect(offlineSyncNotice(base, en, ORDER_41)).toBeNull();
    });
});

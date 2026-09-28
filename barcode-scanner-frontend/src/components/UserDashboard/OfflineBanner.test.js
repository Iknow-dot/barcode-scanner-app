import React from 'react';
import {fireEvent, render, screen, within} from '@testing-library/react';
import OfflineBanner from './OfflineBanner';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';
import {markOffline, markOnline} from '../../utils/connectivity';
import {
    assignOpIds, enqueueOp, getAttention, getOps, parkOp, saveSnapshot,
} from '../../utils/offlineOrderQueue';
import {requestSync} from '../../utils/offlineOrderSync';

// The drain itself is offlineOrderSync.test.js's subject; here only the
// banner's request for one matters.
jest.mock('../../utils/offlineOrderSync', () => ({requestSync: jest.fn()}));

const en = translations.en;

// jsdom lacks these browser APIs that antd's Alert and its motion touch.
beforeAll(() => {
    window.matchMedia = window.matchMedia || ((query) => ({
        matches: false, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
    }));
    global.ResizeObserver = global.ResizeObserver || class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
    global.MessageChannel = global.MessageChannel || class {
        constructor() {
            this.port1 = {onmessage: null, close() {}};
            this.port2 = {postMessage: () => {}, close() {}};
        }
    };
});

const SNAPSHOT = {id: 42, customer_name: 'Nino Beridze', items: []};

const parkScan = (orderId, barcode, details) => {
    enqueueOp(orderId, {type: 'add_item_barcode', tempId: `tmp_${barcode}`, barcode, quantity: 2});
    const op = assignOpIds(orderId).find((o) => o.barcode === barcode);
    parkOp(orderId, op.id, {attempts: 1, detail: null, product: barcode, ...details});
    return op.id;
};

const renderBanner = (orderId = 42, props = {}) => render(
    <LanguageProvider>
        <OfflineBanner orderId={orderId} {...props}/>
    </LanguageProvider>,
);

const attentionList = () => screen.getByRole('region', {name: en.offlineAttentionTitle});

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({id: 99}));
    localStorage.setItem('language', 'en');
    markOnline();
    saveSnapshot(42, SNAPSHOT);
});

afterEach(() => {
    markOnline();
});

test('renders nothing while online with nothing queued or parked', () => {
    const {container} = renderBanner();
    expect(container).toBeEmptyDOMElement();
});

test('still says the app is offline', () => {
    markOffline();
    renderBanner();
    expect(screen.getByText(en.offlineBanner)).toBeInTheDocument();
});

test('lists a line that could not be replayed: what, how many, why, and whose order', () => {
    parkScan(42, '4870001', {reason: 'not_found'});

    renderBanner();

    const row = within(attentionList()).getByRole('listitem');
    expect(row).toHaveTextContent('4870001');
    expect(row).toHaveTextContent(en.offlineOpAdd(2));
    expect(row).toHaveTextContent(en.offlineReasonNotFound);
    expect(row).toHaveTextContent(`${en.orderNumber}42 · Nino Beridze`);
    expect(within(row).getByRole('button', {name: `${en.offlineRetryNow}: 4870001`})).toBeInTheDocument();
    expect(within(row).getByRole('button', {name: `${en.offlineDiscard}: 4870001`})).toBeInTheDocument();
});

test('shows only the lines of the order it is given', () => {
    saveSnapshot(43, {...SNAPSHOT, id: 43});
    parkScan(43, '999', {reason: 'no_stock'});
    parkScan(42, '4870001', {reason: 'not_found'});

    renderBanner(42);

    expect(within(attentionList()).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText('999')).not.toBeInTheDocument();
});

test('Retry now puts the line back in the queue and asks for a sync at once', () => {
    const opId = parkScan(42, '4870001', {reason: 'unavailable', attempts: 6});
    renderBanner();

    fireEvent.click(screen.getByRole('button', {name: `${en.offlineRetryNow}: 4870001`}));

    expect(requestSync).toHaveBeenCalledTimes(1);
    expect(getAttention(42)).toEqual([]);
    expect(getOps(42)).toEqual([expect.objectContaining({id: opId, barcode: '4870001'})]);
    expect(screen.queryByRole('region', {name: en.offlineAttentionTitle})).not.toBeInTheDocument();
    expect(screen.getByText(en.offlinePendingCount(1))).toBeInTheDocument();
});

test('Discard lets the changes it was holding back go at once', () => {
    parkScan(42, '4870001', {reason: 'not_found'});
    enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 5}});
    renderBanner();

    fireEvent.click(screen.getByRole('button', {name: `${en.offlineDiscard}: 4870001`}));

    expect(getAttention(42)).toEqual([]);
    expect(requestSync).toHaveBeenCalledTimes(1);
});

test('Discard drops the line for good', () => {
    parkScan(42, '4870001', {reason: 'not_found'});
    const {container} = renderBanner();

    fireEvent.click(screen.getByRole('button', {name: `${en.offlineDiscard}: 4870001`}));

    expect(getAttention(42)).toEqual([]);
    expect(getOps(42)).toEqual([]);
    expect(requestSync).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
});

// A line can park without the order ever being read back (it could not be
// read, or the drain's closing read failed), so the cart may still show what
// the discarded change made of it. The page reads the order again.
test('Discard tells the page which order lost a line, once the line is gone', () => {
    parkScan(42, '4870001', {reason: 'not_found'});
    const onDiscard = jest.fn(() => expect(getAttention(42)).toEqual([]));
    renderBanner(42, {onDiscard});

    fireEvent.click(screen.getByRole('button', {name: `${en.offlineDiscard}: 4870001`}));

    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledWith(42);
});

test('Retry now does not: the drain it asks for reads the order back itself', () => {
    parkScan(42, '4870001', {reason: 'unavailable', attempts: 6});
    const onDiscard = jest.fn();
    renderBanner(42, {onDiscard});

    fireEvent.click(screen.getByRole('button', {name: `${en.offlineRetryNow}: 4870001`}));

    expect(onDiscard).not.toHaveBeenCalled();
});

import {isOffline, markOffline, markOnline, subscribe} from './connectivity';

afterEach(() => markOnline());

test('starts online', () => {
    expect(isOffline()).toBe(false);
});

test('markOffline flips state and notifies subscribers once per change', () => {
    const seen = [];
    const unsub = subscribe((offline) => seen.push(offline));
    markOffline();
    markOffline(); // no duplicate notification
    markOnline();
    unsub();
    markOffline(); // after unsubscribe — not seen
    expect(seen).toEqual([true, false]);
    markOnline();
});

test('window offline/online events drive state', () => {
    window.dispatchEvent(new Event('offline'));
    expect(isOffline()).toBe(true);
    window.dispatchEvent(new Event('online'));
    expect(isOffline()).toBe(false);
});

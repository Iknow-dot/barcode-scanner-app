import {getStoredDeviceId, storeDeviceId} from './deviceId';

describe('deviceId storage', () => {
    beforeEach(() => localStorage.clear());

    it('returns null when nothing stored', () => {
        expect(getStoredDeviceId()).toBeNull();
    });

    it('stores and returns a device id', () => {
        storeDeviceId('abc123');
        expect(getStoredDeviceId()).toBe('abc123');
    });

    it('ignores empty values', () => {
        storeDeviceId('');
        expect(getStoredDeviceId()).toBeNull();
    });
});

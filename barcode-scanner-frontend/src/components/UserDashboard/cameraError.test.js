import {classifyCameraError, CAMERA_ERROR_KINDS} from './cameraError';
import translations from '../../i18n/translations';

describe('classifyCameraError', () => {
    it('names a denied permission', () => {
        expect(classifyCameraError({name: 'NotAllowedError', message: 'Permission denied'}))
            .toMatchObject({kind: 'permission', canRetry: false});
        expect(classifyCameraError({name: 'PermissionDeniedError'})).toMatchObject({kind: 'permission'});
    });

    it('names a missing camera', () => {
        expect(classifyCameraError({name: 'NotFoundError'})).toMatchObject({kind: 'notFound', canRetry: false});
        expect(classifyCameraError({name: 'DevicesNotFoundError'})).toMatchObject({kind: 'notFound'});
    });

    it('names a camera another app is holding', () => {
        expect(classifyCameraError({name: 'NotReadableError'})).toMatchObject({kind: 'busy', canRetry: true});
        expect(classifyCameraError({name: 'TrackStartError'})).toMatchObject({kind: 'busy'});
    });

    it('falls back to unknown, keeping the original text', () => {
        const result = classifyCameraError({message: 'Something odd'});
        expect(result).toMatchObject({kind: 'unknown', canRetry: true, detail: 'Something odd'});
    });

    it('survives a plain string or a null', () => {
        expect(classifyCameraError('boom')).toMatchObject({kind: 'unknown', detail: 'boom'});
        expect(classifyCameraError(null)).toMatchObject({kind: 'unknown'});
    });

    it('falls back to the message text when error.name is unrecognized', () => {
        expect(classifyCameraError({name: 'SomeWeirdName', message: 'NotAllowedError: nope'}))
            .toMatchObject({kind: 'permission'});
    });

    it('keeps the original error message as detail on every recognized kind', () => {
        expect(classifyCameraError({name: 'NotAllowedError', message: 'Permission denied'}))
            .toMatchObject({detail: 'Permission denied'});
    });

    it('carries a distinct messageKey per kind, and exports the four kinds in order', () => {
        const permission = classifyCameraError({name: 'NotAllowedError'});
        const notFound = classifyCameraError({name: 'NotFoundError'});
        const busy = classifyCameraError({name: 'NotReadableError'});
        const unknown = classifyCameraError({message: 'mystery'});
        const keys = [permission, notFound, busy, unknown].map((r) => r.messageKey);
        expect(new Set(keys).size).toBe(4);
        expect(CAMERA_ERROR_KINDS).toEqual(['permission', 'notFound', 'busy', 'unknown']);
    });

    // F5: BarcodeScanner.js renders `t[cameraError.messageKey]` directly —
    // a renamed or missing key resolves to `undefined` and the consultant
    // sees a warning triangle with no message at all. CAMERA_ERROR_KINDS is
    // exported precisely so this can be checked without hand-copying the
    // kind -> messageKey map a second time here: one representative error
    // per kind, run through the real classifier, so this fails the moment a
    // kind's key drifts out of sync with either locale — including a
    // messageKey that only ka or only en forgot.
    it('has a translated, non-empty message for every camera error kind, in both locales', () => {
        const sampleErrorFor = {
            permission: {name: 'NotAllowedError'},
            notFound: {name: 'NotFoundError'},
            busy: {name: 'NotReadableError'},
            unknown: {message: 'mystery'},
        };
        expect(Object.keys(sampleErrorFor).sort()).toEqual([...CAMERA_ERROR_KINDS].sort());

        CAMERA_ERROR_KINDS.forEach((kind) => {
            const {messageKey} = classifyCameraError(sampleErrorFor[kind]);
            ['ka', 'en'].forEach((locale) => {
                expect(typeof translations[locale][messageKey]).toBe('string');
                expect(translations[locale][messageKey].length).toBeGreaterThan(0);
            });
        });
    });
});

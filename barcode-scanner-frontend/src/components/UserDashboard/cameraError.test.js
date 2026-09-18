import {classifyCameraError, CAMERA_ERROR_KINDS} from './cameraError';

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
});

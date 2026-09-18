// Classifies a camera start failure from html5-qrcode/getUserMedia into a
// small, translatable shape. Pure module, no React — BarcodeScanner.js wires
// this into UI state.
//
// html5-qrcode passes through the browser's own getUserMedia error, so the
// DOMException `name` is the reliable signal; the `message` text is only a
// fallback for the odd string/plain-object shapes html5-qrcode itself throws.
export const CAMERA_ERROR_KINDS = ['permission', 'notFound', 'busy', 'unknown'];

// error.name -> kind. Both the modern and the legacy (prefixed-era) DOMException
// names are listed, since deployed browsers still differ.
const NAME_TO_KIND = {
    NotAllowedError: 'permission',
    PermissionDeniedError: 'permission',
    NotFoundError: 'notFound',
    DevicesNotFoundError: 'notFound',
    NotReadableError: 'busy',
    TrackStartError: 'busy',
};

// kind -> i18n key. `unknown` reuses the pre-existing generic `cameraError`
// string rather than adding a duplicate.
const KIND_TO_MESSAGE_KEY = {
    permission: 'cameraPermissionDenied',
    notFound: 'cameraNotFound',
    busy: 'cameraBusy',
    unknown: 'cameraError',
};

// Retrying without the consultant changing anything cannot succeed for
// `permission` (the browser will not re-prompt once denied in the same page
// load) or `notFound` (no camera hardware exists to find). `busy` (another
// app is holding the camera) and `unknown` are worth trying again.
const NON_RETRYABLE_KINDS = new Set(['permission', 'notFound']);
const canRetryForKind = (kind) => !NON_RETRYABLE_KINDS.has(kind);

const kindFromName = (name) => (name && NAME_TO_KIND[name]) || null;

// Fallback for the odd shapes html5-qrcode/getUserMedia can hand back where
// `name` is missing or unrecognized: sniff the message text for the same
// DOMException names.
const kindFromMessage = (message) => {
    if (typeof message !== 'string') return null;
    const match = Object.keys(NAME_TO_KIND).find((name) => message.includes(name));
    return match ? NAME_TO_KIND[match] : null;
};

const detailOf = (error) => {
    if (typeof error === 'string') return error;
    if (error && typeof error.message === 'string') return error.message;
    return '';
};

export const classifyCameraError = (error) => {
    const name = error && typeof error === 'object' ? error.name : undefined;
    const message = typeof error === 'string' ? error : error && error.message;
    const kind = kindFromName(name) || kindFromMessage(message) || 'unknown';

    return {
        kind,
        messageKey: KIND_TO_MESSAGE_KEY[kind],
        canRetry: canRetryForKind(kind),
        detail: detailOf(error),
    };
};

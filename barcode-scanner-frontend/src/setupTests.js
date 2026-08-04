// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// react-router 7 reaches for TextEncoder/TextDecoder at import time. The jsdom
// bundled with CRA 5's Jest 27 does not expose either as a global, so any test
// that pulls in a routed component dies on `TextEncoder is not defined`. Node
// has had both in `util` since v11.
import {TextDecoder, TextEncoder} from 'util';

if (typeof global.TextEncoder === 'undefined') {
    global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
    global.TextDecoder = TextDecoder;
}

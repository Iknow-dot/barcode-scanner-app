import fs from 'fs';
import path from 'path';
import {TOKENS} from './palette';

// tokens.css is the source of truth; palette.js mirrors it for antd. These
// tests fail when the two drift, or when a value breaks a contrast rule the
// design guide promises (Apple: 4.5:1 for text, 3:1 for bold text).
const css = fs.readFileSync(path.join(__dirname, 'tokens.css'), 'utf8');

const block = (selector) => {
    const start = css.indexOf(`${selector} {`);
    if (start === -1) throw new Error(`tokens.css has no "${selector} {" block`);
    const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
    const vars = {};
    for (const match of body.matchAll(/(--if-[\w-]+)\s*:\s*([^;]+);/g)) {
        vars[match[1]] = match[2].trim();
    }
    return vars;
};

const parse = (value) => {
    const hex = value.match(/^#([0-9a-f]{6})$/i);
    if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
    const rgba = value.match(/^rgba?\(([^)]+)\)$/);
    if (rgba) {
        const parts = rgba[1].split(',').map(Number);
        return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
    }
    throw new Error(`cannot parse colour "${value}"`);
};

// Composite a translucent colour over an opaque one.
const over = (fg, bg) => [0, 1, 2].map((i) => fg[3] * fg[i] + (1 - fg[3]) * bg[i]).concat(1);

const luminance = (c) => {
    const [r, g, b] = c.slice(0, 3).map((x) => {
        const s = x / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};

const WHITE = [255, 255, 255, 1];

describe.each([
    ['light', ':root'],
    ['dark', 'body.dark-theme'],
])('%s palette', (mode, selector) => {
    const token = (name) => parse(TOKENS[mode][`--if-${name}`]);

    test('tokens.css and palette.js hold the same values', () => {
        expect(block(selector)).toEqual(TOKENS[mode]);
    });

    test.each([
        ['white bold label on tint', () => contrast(WHITE, token('tint')), 3],
        ['tint-text on bg', () => contrast(token('tint-text'), token('bg')), 4.5],
        ['tint-text on bg-grouped', () => contrast(token('tint-text'), token('bg-grouped')), 4.5],
        ['tint-text on tint-soft', () => contrast(token('tint-text'), over(token('tint-soft'), token('bg'))), 4.5],
        ['label on bg', () => contrast(token('label'), token('bg')), 4.5],
        ['label on bg-grouped', () => contrast(token('label'), token('bg-grouped')), 4.5],
        ['label-2 on bg', () => contrast(token('label-2'), token('bg')), 4.5],
        ['label-2 on bg-grouped', () => contrast(token('label-2'), token('bg-grouped')), 4.5],
        ['green-text on bg', () => contrast(token('green-text'), token('bg')), 4.5],
        ['orange-text on bg', () => contrast(token('orange-text'), token('bg')), 4.5],
        ['red-text on bg', () => contrast(token('red-text'), token('bg')), 4.5],
    ])('%s meets its minimum contrast', (_, ratio, minimum) => {
        expect(ratio()).toBeGreaterThanOrEqual(minimum);
    });
});

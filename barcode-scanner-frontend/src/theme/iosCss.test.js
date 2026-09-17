import fs from 'fs';
import path from 'path';
import {TOKENS} from './palette';

// ios.css holds the iOS primitives every later redesign phase builds on, so it
// must stay on the palette. Allowed literals: #fff (text or icon on a tint
// fill), the tint's rgb in coloured shadows, and neutral black in shadows and
// masks. Everything else is a var(--if-*) token that exists in palette.js.
const css = fs.readFileSync(path.join(__dirname, 'ios.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

const ALLOWED_LITERALS = [
    /^#fff$/i,
    /^rgba\(58, 152, 102, 0?\.\d+\)$/,
    /^rgba\(0, 0, 0, 0?\.\d+\)$/,
];

test('ios.css hard-codes no colour beyond white on tint and shadow tints', () => {
    const literals = css.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi) || [];
    expect(literals.filter((literal) => !ALLOWED_LITERALS.some((rule) => rule.test(literal)))).toEqual([]);
});

test('ios.css uses no named colours', () => {
    expect(css.match(/(?<![-\w])(white|black|gray|grey|red|green|blue|orange)(?![-\w])/gi)).toBeNull();
});

test('every token ios.css reads exists in the palette', () => {
    const used = [...new Set([...css.matchAll(/var\((--if-[\w-]+)/g)].map((match) => match[1]))];
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !(name in TOKENS.light))).toEqual([]);
});

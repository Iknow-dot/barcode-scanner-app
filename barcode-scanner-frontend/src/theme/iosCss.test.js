import fs from 'fs';
import path from 'path';
import {TOKENS} from './palette';
import {ANTD_OVERLAY_BASE, LAYER_BARS, LAYER_SHEET, LAYER_SHEET_MAX, LAYER_SHEET_STEP, sheetZIndex} from './layers';

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

// z-index of the first rule whose selector is exactly `selector`.
const zIndexOf = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    const value = rule && rule[1].match(/z-index:\s*(\d+)/);
    return value ? Number(value[1]) : NaN;
};

test('the floating bars sit under the sheets, and the sheets under antd overlays', () => {
    expect(zIndexOf('.if-bottom-stack')).toBe(LAYER_BARS);
    expect(zIndexOf('.if-edge-bottom')).toBe(LAYER_BARS - 1);
    expect(LAYER_BARS).toBeLessThan(LAYER_SHEET);
    expect(LAYER_SHEET).toBeLessThan(ANTD_OVERLAY_BASE);
});

// F2: phase 4 stacks a sheet over a sheet (IosSheet's `level` prop).
test('stacked sheet levels stay in the sheet band, strictly below every antd overlay', () => {
    expect(sheetZIndex(0)).toBe(LAYER_SHEET);
    expect(sheetZIndex(1)).toBe(LAYER_SHEET + LAYER_SHEET_STEP);
    expect(sheetZIndex(1)).toBeGreaterThan(sheetZIndex(0));
    expect(sheetZIndex(1)).toBeLessThan(ANTD_OVERLAY_BASE);
    // Clamped: an unreasonably deep stack never reaches antd's own band.
    expect(sheetZIndex(50)).toBe(LAYER_SHEET_MAX);
    expect(sheetZIndex(50)).toBeLessThan(ANTD_OVERLAY_BASE);
});

test('the layout column is set on :root, where sheets portaled into body can read it', () => {
    expect(css).toMatch(/:root\s*\{\s*--layout-column:\s*600px;/);
    const indexCss = fs.readFileSync(path.join(__dirname, '..', 'index.css'), 'utf8');
    expect(indexCss).not.toMatch(/--layout-column\s*:/);
});

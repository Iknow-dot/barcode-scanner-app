import fs from 'fs';
import path from 'path';
import {TOKENS} from './palette';
import {
    ANTD_OVERLAY_BASE,
    ANTD_STATIC_MODAL,
    LAYER_BARS,
    LAYER_SCANNER,
    LAYER_SCANNER_CHROME,
    LAYER_SHEET,
    LAYER_SHEET_MAX,
    LAYER_SHEET_STEP,
    sheetZIndex,
} from './layers';

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

// z-index of the first rule whose selector is exactly `selector`, read out of
// the given stylesheet string. Parameterised over the stylesheet (rather than
// closing over `css`) so ios.css and BarcodeScanner.css below share one
// lookup regex instead of each keeping a near-identical copy in sync by hand.
const zIndexOf = (stylesheet, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = stylesheet.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    const value = rule && rule[1].match(/z-index:\s*(\d+)/);
    return value ? Number(value[1]) : NaN;
};

test('the floating bars sit under the sheets, and the sheets under antd overlays', () => {
    expect(zIndexOf(css, '.if-bottom-stack')).toBe(LAYER_BARS);
    expect(zIndexOf(css, '.if-edge-bottom')).toBe(LAYER_BARS - 1);
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

// F4 task 1: the client-lookup search field and its info banner.
test('the search field and info banner primitives exist with no literal colours', () => {
    const searchStart = css.indexOf('.if-search {');
    const bannerTextIndex = css.indexOf('.if-banner-text');
    expect(searchStart).toBeGreaterThan(-1);
    expect(bannerTextIndex).toBeGreaterThan(searchStart);
    const block = css.slice(searchStart, css.indexOf('}', bannerTextIndex) + 1);

    ['.if-search', '.if-search-input', '.if-search-trail', '.if-banner'].forEach((selector) => {
        expect(block).toContain(selector);
    });
    expect(block.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull();
});

// F5a task 2: the orders canvas row primitives (avatar, inset separator, trailing column).
test('the orders-row avatar, inset separator and trailing column exist with no literal colours', () => {
    const avatarStart = css.indexOf('.if-avatar {');
    const trailingStart = css.indexOf('.if-row-trailing {');
    expect(avatarStart).toBeGreaterThan(-1);
    expect(trailingStart).toBeGreaterThan(avatarStart);
    const block = css.slice(avatarStart, css.indexOf('}', trailingStart) + 1);

    ['.if-avatar', '.if-group.is-avatar-inset', '.if-row-trailing'].forEach((selector) => {
        expect(block).toContain(selector);
    });
    expect(block.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull();
});

// Swipe-to-reveal order-row actions: revealed by the JS-controlled state
// class, but also by plain CSS on :hover and :focus-within so a mouse or
// keyboard user reaches print/delete without ever swiping (no literal
// colours check here — the top-of-file "hard-codes no colour" test already
// covers this block along with the rest of the file).
test('the swipe-to-reveal row actions are revealed by state, hover and keyboard focus alike', () => {
    expect(css).toContain('.if-swipe-row');
    expect(css).toContain('.if-swipe-actions');
    expect(css).toContain('.if-swipe-content');
    expect(css).toMatch(/\.if-swipe-row\.is-open \.if-swipe-content/);
    expect(css).toMatch(/\.if-swipe-row:focus-within \.if-swipe-content/);
    expect(css).toMatch(/@media \(hover: hover\)[\s\S]*\.if-swipe-row:hover \.if-swipe-content/);
});

// ====================================================================
// F5b task 2: the full-screen barcode scanner overlay
// (BarcodeScanner.css). Unlike ios.css, it sits over a live camera feed
// rather than the themed page, so CLAUDE.md sanctions its fixed blacks and
// whites (solid and translucent) as a literal-colour exception. Everything
// else in the file must still be a var(--if-*) token.
// ====================================================================
const scannerCss = fs.readFileSync(
    path.join(__dirname, '..', 'components', 'UserDashboard', 'BarcodeScanner.css'),
    'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

const SCANNER_ALLOWED_LITERALS = [
    /^#000$/i,
    /^#fff$/i,
    /^rgba\(0, 0, 0, 0?\.\d+\)$/,
    /^rgba\(255, 255, 255, 0?\.\d+\)$/,
];

test("BarcodeScanner.css hard-codes no colour beyond the camera overlay's blacks and whites", () => {
    const literals = scannerCss.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi) || [];
    expect(literals.filter((literal) => !SCANNER_ALLOWED_LITERALS.some((rule) => rule.test(literal)))).toEqual([]);
});

// F7: the literal-colour check above only catches hex/rgb/hsl forms — a
// named colour like `color: red` would sail through it undetected. ios.css
// has had this companion check since early on; BarcodeScanner.css didn't.
test('BarcodeScanner.css uses no named colours', () => {
    expect(scannerCss.match(/(?<![-\w])(white|black|gray|grey|red|green|blue|orange)(?![-\w])/gi)).toBeNull();
});

test('every token BarcodeScanner.css reads exists in the palette', () => {
    const used = [...new Set([...scannerCss.matchAll(/var\((--if-[\w-]+)/g)].map((match) => match[1]))];
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !(name in TOKENS.light))).toEqual([]);
});

// BarcodeScanner.css's z-index literals are kept in sync with layers.js by
// hand, since BarcodeScanner.js is out of scope for this change — see the
// file's own header comment. Read via the shared `zIndexOf` above, not a
// second copy of its regex.

test('the scanner sits above every antd overlay and below its own chrome, both below antd\'s static Modal.confirm', () => {
    expect(zIndexOf(scannerCss, '.scanner-overlay')).toBe(LAYER_SCANNER);
    expect(zIndexOf(scannerCss, '.scanner-top-bar')).toBe(LAYER_SCANNER_CHROME);
    expect(zIndexOf(scannerCss, '.scanner-bottom-bar')).toBe(LAYER_SCANNER_CHROME);
    expect(LAYER_SCANNER).toBeGreaterThan(ANTD_OVERLAY_BASE);
    expect(LAYER_SCANNER_CHROME).toBeGreaterThan(LAYER_SCANNER);
    expect(LAYER_SCANNER_CHROME).toBeLessThan(ANTD_STATIC_MODAL);
});

test("the scan line's glow is derived from the brand token, not a hand-copied rgb() duplicate", () => {
    expect(scannerCss).toMatch(/color-mix\(in srgb, var\(--if-brand\)[^)]*\)/);
    expect(scannerCss).not.toMatch(/rgba\(\s*66,\s*174,\s*117/);
});

import {TILE_PALETTE, paletteIndex, monogram} from './categoryTileStyle';

test('TILE_PALETTE has 6 entries with a gradient bg and hex fg', () => {
  expect(TILE_PALETTE).toHaveLength(6);
  TILE_PALETTE.forEach((p) => {
    expect(p.bg).toMatch(/^linear-gradient/);
    expect(p.fg).toMatch(/^#/);
  });
});

test('paletteIndex is deterministic and within bounds for numeric and string ids', () => {
  [0, 1, 7, 42, 1337, '9f31', 'cat-77'].forEach((id) => {
    const idx = paletteIndex(id);
    expect(idx).toBe(paletteIndex(id));
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(TILE_PALETTE.length);
  });
});

test('monogram returns the first character, trimmed and empty-safe', () => {
  expect(monogram('სამზარეულო')).toBe('ს');
  expect(monogram('pans')).toBe('p');
  expect(monogram('  padded')).toBe('p');
  expect(monogram('')).toBe('');
  expect(monogram(null)).toBe('');
});

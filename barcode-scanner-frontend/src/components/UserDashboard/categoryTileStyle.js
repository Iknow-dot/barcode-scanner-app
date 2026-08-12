// Deterministic tile styling for the catalog drawer's root category grid.
// Category ids come from 1C and carry no display metadata, so the gradient
// is hash-picked (stable per id) and the tile icon is the name's first
// character — works for any alphabet, no curation possible.

export const TILE_PALETTE = [
    {bg: 'linear-gradient(135deg, #fdf1e7, #fbe3cf)', fg: '#c2410c'},
    {bg: 'linear-gradient(135deg, #e9f2fb, #d7e8f9)', fg: '#1d4ed8'},
    {bg: 'linear-gradient(135deg, #f3eef8, #e8ddf3)', fg: '#7c3aed'},
    {bg: 'linear-gradient(135deg, #e8f5f0, #d5ecdf)', fg: '#047857'},
    {bg: 'linear-gradient(135deg, #fbeff3, #f7dde7)', fg: '#be185d'},
    {bg: 'linear-gradient(135deg, #f7f4e9, #efe8d0)', fg: '#a16207'},
];

export function paletteIndex(id) {
    const s = String(id ?? '');
    let h = 0;
    for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % TILE_PALETTE.length;
}

// No case transformation: Georgian mkhedruli is caseless, and uppercasing it
// can surface Mtavruli forms that read as a different letter.
export function monogram(name) {
    return Array.from(String(name ?? '').trim()).slice(0, 1).join('');
}

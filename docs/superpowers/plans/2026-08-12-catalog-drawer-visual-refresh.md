# Catalog Drawer Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the consultant-side "Find product" drawer per the approved spec — category tile wall at the root, chip subcategories + crumb header when drilled, rich card product rows with a missing-photo placeholder — with zero behavior change.

**Architecture:** Presentation-only rework of `FindProductDrawer.js`. All state, effects, sequencing tokens (`browseSeqRef`/`searchSeqRef`), callbacks, and API calls stay byte-identical; only the JSX below the search row and two new pure helper modules change. Styling moves to a new `FindProductDrawer.css` (`fpd-` prefix), following the `BarcodeScanner.css` precedent.

**Tech Stack:** React 18 (CRA), Ant Design 6 (`Drawer`/`Input`/`Button`/`Switch`/`Spin`/`Empty` stay), @testing-library/react + jest.

**Spec:** `docs/superpowers/specs/2026-08-12-catalog-drawer-visual-refresh-design.md` · Visual reference: `.claude/catalog-final-mockup.html`

## Global Constraints

- **Frontend only.** Nothing under `backend/` changes. No new dependencies.
- All commands run from `barcode-scanner-frontend/`. Test command: `npm test -- --watchAll=false --testPathPattern="<pattern>"` (the package.json scripts already carry `--openssl-legacy-provider` — never remove it).
- Behavior is frozen: same props, same `catalogService` calls with the same arguments, same debounce/sequencing logic, tap-a-row still calls `onSelectProduct(sku)` and nothing else. The row's "+" is decorative (`aria-hidden`), not a second tap target.
- Every new user-visible string is added to BOTH `ka` and `en` blocks of `src/i18n/translations.js`. Georgian copy verbatim from this plan.
- Georgian text gets no case transformation (uppercasing mkhedruli can surface Mtavruli forms).
- The back pill must remain a real `<button>` whose accessible name contains the parent label — existing tests select it via `getByRole('button', {name: /All categories/})`.
- Commit after each task; stage by explicit path (`git add <files>` — this checkout may be shared with concurrent sessions, never `git add -A`).

---

## File Structure

| File | Role |
|---|---|
| Create `src/components/UserDashboard/categoryTileStyle.js` | Pure tile-style helpers: `TILE_PALETTE`, `paletteIndex(id)`, `monogram(name)` |
| Create `src/components/UserDashboard/categoryTileStyle.test.js` | Unit tests for the above |
| Modify `src/components/UserDashboard/catalogBrowse.js` | Add pure helper `subPath(categoryPath, crumbNames)` |
| Modify `src/components/UserDashboard/catalogBrowse.test.js` | Tests for `subPath` |
| Create `src/components/UserDashboard/FindProductDrawer.css` | All new styles, `fpd-` prefix |
| Modify `src/components/UserDashboard/FindProductDrawer.js` | JSX rework: tiles, chips, crumb header, card rows |
| Modify `src/components/UserDashboard/FindProductDrawer.test.js` | Updated + new component tests |
| Modify `src/i18n/translations.js` | Add `categoriesLabel`, `productCountSuffix` (ka + en) |

---

### Task 1: Pure helpers — tile styling and sub-path

**Files:**
- Create: `src/components/UserDashboard/categoryTileStyle.js`
- Create: `src/components/UserDashboard/categoryTileStyle.test.js`
- Modify: `src/components/UserDashboard/catalogBrowse.js` (append one function)
- Modify: `src/components/UserDashboard/catalogBrowse.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 2–3):
  - `TILE_PALETTE: Array<{bg: string, fg: string}>` (length 6)
  - `paletteIndex(id: number|string): number` — stable, `0..TILE_PALETTE.length-1`
  - `monogram(name: string|null): string` — first character, trimmed, empty-safe
  - `subPath(categoryPath: string[]|undefined, crumbNames: string[]): string` — `' › '`-joined segments deeper than the crumb, `''` if none

- [ ] **Step 1: Write the failing tests**

Create `src/components/UserDashboard/categoryTileStyle.test.js`:

```js
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
```

In `catalogBrowse.test.js`, extend the import and append at the end of the file:

```js
// import line becomes:
import {
  findNode,
  nodeForStack,
  childrenForStack,
  breadcrumbForStack,
  parentStack,
  subPath,
} from './catalogBrowse';
```

```js
test('subPath returns the segments deeper than the current crumb', () => {
  expect(subPath(['Beverages', 'Coffee'], ['Beverages'])).toBe('Coffee');
  expect(subPath(['Beverages', 'Coffee', 'Beans'], ['Beverages'])).toBe('Coffee › Beans');
  expect(subPath(['Beverages'], ['Beverages'])).toBe('');
  expect(subPath([], ['Beverages'])).toBe('');
  expect(subPath(undefined, [])).toBe('');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --watchAll=false --testPathPattern="categoryTileStyle|catalogBrowse"`
Expected: FAIL — `categoryTileStyle` module not found; `subPath` is not a function.

- [ ] **Step 3: Write the implementations**

Create `src/components/UserDashboard/categoryTileStyle.js`:

```js
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
```

Append to `src/components/UserDashboard/catalogBrowse.js`:

```js
// Display helper for branch product listings: a row's category path minus the
// current crumb prefix, e.g. inside "Kitchen" a product living in
// Kitchen › Pans renders "Pans"; a product at the current node renders ''.
export function subPath(categoryPath, crumbNames) {
    const path = categoryPath || [];
    const depth = (crumbNames || []).length;
    return path.length > depth ? path.slice(depth).join(' › ') : '';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --watchAll=false --testPathPattern="categoryTileStyle|catalogBrowse"`
Expected: PASS (all, including the pre-existing catalogBrowse tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/UserDashboard/categoryTileStyle.js src/components/UserDashboard/categoryTileStyle.test.js src/components/UserDashboard/catalogBrowse.js src/components/UserDashboard/catalogBrowse.test.js
git commit -m "feat(frontend): tile palette and sub-path helpers for catalog drawer"
```

---

### Task 2: Category navigation chrome — tiles at root, chips + crumb header when drilled

**Files:**
- Create: `src/components/UserDashboard/FindProductDrawer.css`
- Modify: `src/components/UserDashboard/FindProductDrawer.js`
- Modify: `src/components/UserDashboard/FindProductDrawer.test.js`
- Modify: `src/i18n/translations.js`

**Interfaces:**
- Consumes: `TILE_PALETTE`, `paletteIndex(id)`, `monogram(name)` from `./categoryTileStyle` (Task 1).
- Produces: CSS classes `fpd-*` (Task 3 reuses `fpd-row*`/`fpd-thumb*`); i18n keys `t.categoriesLabel`, `t.productCountSuffix`; a `currentNode` memo inside the component.

- [ ] **Step 1: Add i18n keys**

In `src/i18n/translations.js`, find the **ka** line `productsLabel: 'პროდუქტები',` (~line 549) and insert directly after it:

```js
        categoriesLabel: 'კატეგორიები',
        productCountSuffix: 'პროდუქტი',
```

Find the **en** line `productsLabel: 'Products',` (~line 1196) and insert directly after it:

```js
        categoriesLabel: 'Categories',
        productCountSuffix: 'products',
```

- [ ] **Step 2: Create the stylesheet**

Create `src/components/UserDashboard/FindProductDrawer.css` (full file — Task 3's row classes are included here so the file is written once):

```css
/* Catalog drawer visual refresh (fpd- prefix). Layout constants mirror
   .claude/catalog-final-mockup.html; app ships a single light theme. */

.fpd-seccap {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: rgba(0, 0, 0, 0.45);
    margin: 8px 2px 6px;
}

/* --- root: category tile wall --- */
.fpd-tiles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
}
.fpd-tile {
    border: 1px solid rgba(0, 0, 0, 0.05);
    border-radius: 14px;
    padding: 14px 12px 12px;
    min-height: 92px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: flex-start;
    gap: 2px;
    position: relative;
    overflow: hidden;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
}
.fpd-tile-mono {
    position: absolute;
    top: 2px;
    right: 10px;
    font-size: 42px;
    font-weight: 800;
    opacity: 0.16;
    line-height: 1.2;
    pointer-events: none;
}
.fpd-tile-name {
    font-weight: 650;
    font-size: 13.5px;
    line-height: 1.25;
    position: relative;
    color: rgba(0, 0, 0, 0.88);
}
.fpd-tile-count {
    font-size: 11.5px;
    color: rgba(0, 0, 0, 0.5);
    position: relative;
}

/* --- drilled: crumb header + subcategory chips --- */
.fpd-crumbpath {
    font-size: 11px;
    color: rgba(0, 0, 0, 0.4);
    margin: 6px 2px 2px;
}
.fpd-crumbline {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 6px 2px 8px;
}
.fpd-backpill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 12px 0 8px;
    border-radius: 999px;
    border: none;
    background: rgba(22, 119, 255, 0.08);
    color: #1677ff;
    font-size: 12.5px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    font-family: inherit;
}
.fpd-crumbtitle {
    font-weight: 650;
    font-size: 15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.fpd-crumbcount {
    color: rgba(0, 0, 0, 0.4);
    font-size: 12px;
    margin-left: auto;
    white-space: nowrap;
}
.fpd-chips {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding: 2px 2px 10px;
    scrollbar-width: none;
}
.fpd-chips::-webkit-scrollbar {
    display: none;
}
.fpd-chip {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 13px;
    border-radius: 999px;
    background: #fff;
    border: 1px solid rgba(0, 0, 0, 0.1);
    font-size: 12.5px;
    font-weight: 500;
    white-space: nowrap;
    color: rgba(0, 0, 0, 0.75);
    cursor: pointer;
    font-family: inherit;
}
.fpd-chip-cnt {
    font-size: 11px;
    color: rgba(0, 0, 0, 0.4);
    font-weight: 400;
}

/* --- product card rows (used by Task 3) --- */
.fpd-row {
    display: flex;
    align-items: center;
    gap: 12px;
    background: #fff;
    border: 1px solid rgba(0, 0, 0, 0.06);
    border-radius: 12px;
    padding: 10px 12px;
    margin-bottom: 8px;
    cursor: pointer;
}
.fpd-thumb {
    flex: none;
    width: 56px;
    height: 56px;
    border-radius: 10px;
    border: 1px solid rgba(0, 0, 0, 0.05);
    background: rgba(22, 119, 255, 0.06);
    color: rgba(22, 119, 255, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    position: relative;
    overflow: hidden;
}
.fpd-thumb-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.fpd-row-main {
    flex: 1;
    min-width: 0;
}
.fpd-row-name {
    font-weight: 600;
    font-size: 13.5px;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
.fpd-row-meta {
    color: rgba(0, 0, 0, 0.45);
    font-size: 11.5px;
    margin-top: 2px;
}
.fpd-row-side {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
}
.fpd-row-price {
    font-weight: 700;
    font-size: 14px;
    font-variant-numeric: tabular-nums;
}
.fpd-row-add {
    width: 26px;
    height: 26px;
    border-radius: 8px;
    background: rgba(22, 119, 255, 0.1);
    color: #1677ff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    font-weight: 600;
}
```

- [ ] **Step 3: Update the component tests (write the failing tests first)**

In `FindProductDrawer.test.js`:

3a. Replace the `TREE` constant (Snacks gains a child so depth 2 is reachable):

```js
const TREE = [
  {id: 1, name: 'Snacks', product_count: 2, children: [
    {id: 3, name: 'Salty', product_count: 1, children: []},
  ]},
  {id: 2, name: 'Beverages', product_count: 1, children: []},
];
```

3b. In the test `'browse position and rows survive typing and clearing a query'`, replace the line

```js
    expect(screen.getByText('All categories › Snacks')).toBeInTheDocument();
```

with (the full-path line no longer exists at depth 1 — the back pill + title carry the position):

```js
    expect(screen.getByRole('button', {name: /All categories/})).toBeInTheDocument();
    expect(screen.getByText('Snacks')).toBeInTheDocument();
```

3c. Append a new describe block at the end of the file:

```js
describe('category navigation chrome', () => {
  test('root renders category tiles with product counts and no crumb chrome', async () => {
    await renderDrawer();
    expect(screen.getByText('Categories')).toBeInTheDocument();
    expect(document.querySelectorAll('.fpd-tile')).toHaveLength(2);
    expect(screen.getByText('2 products')).toBeInTheDocument();
    expect(screen.getByText('1 products')).toBeInTheDocument();
    expect(document.querySelector('.fpd-crumbline')).not.toBeInTheDocument();
  });

  test('depth 1: back pill, bold title with count, children as chips, no path line', async () => {
    await renderDrawer();
    fireEvent.click(screen.getByText('Snacks'));
    expect(screen.getByRole('button', {name: /All categories/})).toBeInTheDocument();
    expect(document.querySelector('.fpd-crumbtitle').textContent).toBe('Snacks');
    expect(screen.getByText('2 products')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /Salty/})).toBeInTheDocument();
    expect(document.querySelector('.fpd-crumbpath')).not.toBeInTheDocument();
  });

  test('depth 2: the full path line appears and the back pill names the parent', async () => {
    await renderDrawer();
    fireEvent.click(screen.getByText('Snacks'));
    fireEvent.click(screen.getByRole('button', {name: /Salty/}));
    expect(screen.getByText('All categories › Snacks › Salty')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /Snacks/})).toBeInTheDocument();
    expect(document.querySelector('.fpd-crumbtitle').textContent).toBe('Salty');
  });
});
```

- [ ] **Step 4: Run the component tests to verify the new ones fail**

Run: `npm test -- --watchAll=false --testPathPattern="FindProductDrawer"`
Expected: the three new tests FAIL (no `.fpd-tile` in the DOM); pre-existing tests still pass (the old UI renders `Snacks`/`Beverages` rows and the `All categories` back button, and TREE's new child doesn't disturb them).

- [ ] **Step 5: Rework the component's category JSX**

In `FindProductDrawer.js`:

5a. Add imports and the memo:

```js
import './FindProductDrawer.css';
import {TILE_PALETTE, paletteIndex, monogram} from './categoryTileStyle';
```

Next to the existing memos (after the `parentNode` line):

```js
    const currentNode = useMemo(() => nodeForStack(tree, stack), [tree, stack]);
```

5b. Replace the entire browse fragment — everything between `) : (` and the closing `)}` of the `searching ? … : …` conditional (currently the `stack.length > 0 && …` block, the category `<List>`, and the products section) — with:

```jsx
                    <>
                        {stack.length === 0 ? (
                            <>
                                <div className="fpd-seccap">{t.categoriesLabel}</div>
                                <div className="fpd-tiles">
                                    {children.map((node) => {
                                        const palette = TILE_PALETTE[paletteIndex(node.id)];
                                        return (
                                            <button
                                                type="button"
                                                key={node.id}
                                                className="fpd-tile"
                                                style={{background: palette.bg}}
                                                onClick={() => setStack([...stack, node.id])}
                                            >
                                                <span className="fpd-tile-mono" style={{color: palette.fg}} aria-hidden="true">
                                                    {monogram(node.name)}
                                                </span>
                                                <span className="fpd-tile-name">{node.name}</span>
                                                <span className="fpd-tile-count">
                                                    {node.product_count} {t.productCountSuffix}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </>
                        ) : (
                            <>
                                {stack.length >= 2 && (
                                    <div className="fpd-crumbpath">
                                        {[t.allCategories, ...crumb].join(' › ')}
                                    </div>
                                )}
                                <div className="fpd-crumbline">
                                    <button
                                        type="button"
                                        className="fpd-backpill"
                                        onClick={() => setStack(parentStack(stack))}
                                    >
                                        <LeftOutlined/> {parentNode ? parentNode.name : t.allCategories}
                                    </button>
                                    <span className="fpd-crumbtitle">{currentNode ? currentNode.name : ''}</span>
                                    {currentNode != null && (
                                        <span className="fpd-crumbcount">
                                            {currentNode.product_count} {t.productCountSuffix}
                                        </span>
                                    )}
                                </div>
                                {children.length > 0 && (
                                    <div className="fpd-chips">
                                        {children.map((node) => (
                                            <button
                                                type="button"
                                                key={node.id}
                                                className="fpd-chip"
                                                onClick={() => setStack([...stack, node.id])}
                                            >
                                                {node.name} <span className="fpd-chip-cnt">{node.product_count}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <div style={{marginTop: 8}}>
                                    <Text type="secondary" style={{fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4}}>
                                        {t.productsLabel}{count ? ` · ${count}` : ''}
                                    </Text>
                                    <Spin spinning={browseLoading} size="small">
                                        {rows.length === 0 && !browseLoading ? (
                                            <Empty
                                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                                description={t.noProductsFound}
                                                style={{margin: '16px 0'}}
                                            />
                                        ) : (
                                            <>
                                                <List
                                                    size="small"
                                                    dataSource={rows}
                                                    renderItem={(item) => renderProductRow(item, [
                                                        item.article,
                                                        item.price != null ? `${item.price} ₾` : '',
                                                    ])}
                                                />
                                                {rows.length < count && (
                                                    <Button
                                                        block
                                                        onClick={() => fetchProducts(currentId, page + 1)}
                                                        loading={browseLoading}
                                                        style={{marginTop: 8}}
                                                    >
                                                        {t.loadMore}
                                                    </Button>
                                                )}
                                            </>
                                        )}
                                    </Spin>
                                </div>
                            </>
                        )}
                    </>
```

Notes on this step:
- The products section (`Text` caption + `List` + load-more) is **copied verbatim from the current file** — Task 3 replaces it; this task only changes category navigation. The old `currentId != null` guard around it is dropped because the drilled branch implies it (`stack` non-empty ⇒ `currentId != null`).
- `RightOutlined` is now unused — remove it from the `@ant-design/icons` import line.
- `LeftOutlined`, `List`, `Text`, `Empty`, `Spin`, `Button` are all still used at this point.

- [ ] **Step 6: Run the component tests to verify everything passes**

Run: `npm test -- --watchAll=false --testPathPattern="FindProductDrawer"`
Expected: PASS — all pre-existing tests (debounce, stale-response, root-invalidation, browse-position) plus the three new chrome tests.

- [ ] **Step 7: Commit**

```bash
git add src/components/UserDashboard/FindProductDrawer.css src/components/UserDashboard/FindProductDrawer.js src/components/UserDashboard/FindProductDrawer.test.js src/i18n/translations.js
git commit -m "feat(frontend): category tiles and chip navigation in find-product drawer"
```

---

### Task 3: Rich product card rows with placeholder thumbnail

**Files:**
- Modify: `src/components/UserDashboard/FindProductDrawer.js`
- Modify: `src/components/UserDashboard/FindProductDrawer.test.js`

**Interfaces:**
- Consumes: `subPath(categoryPath, crumbNames)` from `./catalogBrowse` (Task 1); CSS classes `fpd-row*`, `fpd-thumb*` (Task 2); the component's existing `crumb` memo, `handleSelect(sku)`, `results`, `rows`.
- Produces: `renderProductRow(item, meta)` where `meta` is a pre-joined string; internal `RowThumb` component. No external interface changes.

- [ ] **Step 1: Update the test harness and write the failing tests**

1a. In `FindProductDrawer.test.js`, replace `renderDrawer` so a test can inject and observe `onSelectProduct`:

```js
const renderDrawer = async ({onCommit = () => {}, onSelectProduct = jest.fn()} = {}) => {
  const utils = render(
    <React.Profiler id="find-product-drawer" onRender={onCommit}>
      <LanguageProvider>
        <FindProductDrawer
          open
          onClose={jest.fn()}
          onSelectProduct={onSelectProduct}
          onScan={jest.fn()}
          allWarehouses={false}
          onAllWarehousesChange={jest.fn()}
          orderMode={false}
        />
      </LanguageProvider>
    </React.Profiler>
  );
  // Flush the categoryTree load so the root category list is on screen.
  await act(async () => {});
  return {...utils, onSelectProduct};
};
```

1b. Append a new describe block at the end of the file:

```js
describe('product card rows', () => {
  test('a row shows article and price and fires onSelectProduct with the sku', async () => {
    const snacks = deferred();
    catalogService.listProducts.mockReturnValueOnce(snacks.promise);
    const onSelectProduct = jest.fn();
    await renderDrawer({onSelectProduct});

    fireEvent.click(screen.getByText('Snacks'));
    await act(async () => snacks.resolve(browsePage(['Chips'])));

    expect(screen.getByText('ART-Chips')).toBeInTheDocument();
    expect(screen.getByText('5 ₾')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Chips'));
    expect(onSelectProduct).toHaveBeenCalledWith('SKU-Chips');
  });

  test('a product without an image renders the placeholder thumb', async () => {
    const snacks = deferred();
    catalogService.listProducts.mockReturnValueOnce(snacks.promise);
    await renderDrawer();

    fireEvent.click(screen.getByText('Snacks'));
    await act(async () => snacks.resolve(browsePage(['Chips'])));

    const thumb = document.querySelector('.fpd-row .fpd-thumb');
    expect(thumb).toBeInTheDocument();
    expect(thumb.querySelector('.fpd-thumb-img')).toBeNull();
  });

  test('search rows append the full category path to the meta line', async () => {
    catalogService.searchByName.mockResolvedValue(
      {success: true, data: [searchRow('Pretzels')]});
    await renderDrawer();

    typeQuery('pre');
    act(() => jest.advanceTimersByTime(300));
    await act(async () => {});

    expect(screen.getByText('ART-Pretzels · Snacks')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npm test -- --watchAll=false --testPathPattern="FindProductDrawer"`
Expected: the three new tests FAIL (`.fpd-row` absent; old meta joins price into the meta text, so `'5 ₾'` exists only inside `'ART-Chips · 5 ₾'`, not as its own element). Pre-existing tests pass.

- [ ] **Step 3: Replace the row rendering in the component**

In `FindProductDrawer.js`:

3a. Imports: remove `List` from the `antd` import; add `PictureOutlined` to the `@ant-design/icons` import; extend the catalogBrowse import to include `subPath`:

```js
import {childrenForStack, nodeForStack, breadcrumbForStack, parentStack, subPath} from './catalogBrowse';
```

3b. Add `RowThumb` above the `FindProductDrawer` component definition (module level):

```jsx
// 56px thumb with a built-in placeholder: the ProductImage overlays the tinted
// box when it loads; a missing src or a failed load (ProductImage renders
// nothing then) leaves the placeholder visible. ProductImage stays unchanged.
const RowThumb = ({item}) => {
    const src = item.image || (item.images && item.images[0]);
    return (
        <div className="fpd-thumb">
            <PictureOutlined/>
            {src ? (
                <ProductImage
                    src={catalogService.imageUrl(src)}
                    alt={item.name}
                    className="fpd-thumb-img"
                />
            ) : null}
        </div>
    );
};
```

3c. Replace the whole `renderProductRow` function with (note the signature change: second argument is now a pre-joined string, and price moved out of the meta):

```jsx
    const renderProductRow = (item, meta) => (
        <div key={item.sku} className="fpd-row" onClick={() => handleSelect(item.sku)}>
            <RowThumb item={item}/>
            <div className="fpd-row-main">
                <div className="fpd-row-name">{item.name}</div>
                {meta ? <div className="fpd-row-meta">{meta}</div> : null}
            </div>
            <div className="fpd-row-side">
                {item.price != null && <span className="fpd-row-price">{item.price} ₾</span>}
                <span className="fpd-row-add" aria-hidden="true">+</span>
            </div>
        </div>
    );
```

3d. In the search branch, replace the `<List size="small" dataSource={results} …/>` element with:

```jsx
                            <div>
                                {results.map((item) => renderProductRow(item,
                                    [item.article, (item.category_path || []).join(' › ')]
                                        .filter(Boolean).join(' · ')))}
                            </div>
```

3e. In the browse products section (inside the drilled branch from Task 2), delete the `<Text …>{t.productsLabel}…</Text>` caption line entirely (the count already lives in the crumb header), and replace the `<List size="small" dataSource={rows} …/>` element with:

```jsx
                                                <div>
                                                    {rows.map((item) => renderProductRow(item,
                                                        [item.article, subPath(item.category_path, crumb)]
                                                            .filter(Boolean).join(' · ')))}
                                                </div>
```

The surrounding `Spin`/`Empty`/load-more `Button` stay exactly as they are.

3f. `Text` is still used by the all-warehouses row — check with a search that `Typography`/`Text` remains referenced before touching its import (leave it; only `List` and `RightOutlined` go). Run a quick usage check for `productsLabel`:

```bash
grep -rn "productsLabel" src
```

Expected: only `translations.js` (both language blocks) — the key stays defined but unused, harmless. If another component uses it, leave everything alone.

- [ ] **Step 4: Run the component tests to verify everything passes**

Run: `npm test -- --watchAll=false --testPathPattern="FindProductDrawer"`
Expected: PASS — all pre-existing + Task 2 + Task 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/UserDashboard/FindProductDrawer.js src/components/UserDashboard/FindProductDrawer.test.js
git commit -m "feat(frontend): rich product card rows in find-product drawer"
```

---

### Task 4: Full verification — suite, build, live browser check

**Files:** none created; fixes (if any) land in the files above.

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: a verified, committed feature; screenshots of the four states for the user.

- [ ] **Step 1: Run the full frontend test suite**

Run (from `barcode-scanner-frontend/`): `npm test -- --watchAll=false`
Expected: PASS with zero failures. Any failure elsewhere (e.g. a snapshot or an import) gets fixed before proceeding.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: compiles cleanly (warnings pre-existing on the branch are acceptable; new warnings about unused imports in `FindProductDrawer.js` are not — remove the offending import).

- [ ] **Step 3: Live check of all four states**

Start the dev stack via the Browser pane using the existing `.claude/launch.json` entries (backend + CRA dev server; see the repo memory "Browser-verify recipe" — use a fresh backend port if 8000 is squatted, and use JS `el.click()` for bottom-nav/drawer buttons the pane can't reach). Then, logged in as a company user:

1. Open the Find-product drawer → **root**: tile wall renders, 2 columns, counts, stable colors on reopen.
2. Tap a tile → **depth 1**: back pill "‹ ყველა კატეგორია", bold title + `N პროდუქტი`, children as chips, card rows with photo/placeholder, price right-aligned, no `პროდუქტები ·` caption.
3. Tap a chip → **depth 2**: `ყველა კატეგორია › … › …` path line appears; back pill names the parent.
4. Type a query → **search**: card rows with `article · full path` meta; clear restores the browse position.
5. Tap a row → the live 1C lookup + add-to-cart funnel behaves exactly as before.

Take a screenshot of each state and send them to the user.

- [ ] **Step 4: Commit any verification fixes**

```bash
git add <only-the-files-you-fixed>
git commit -m "fix(frontend): <what the live check surfaced>"
```

(Skip if nothing needed fixing.)

---

## Self-Review Notes

- **Spec coverage:** §3 root tiles → Task 2; §4 crumb header/chips/card rows/placeholder/"+"-affordance/caption-removal → Tasks 2–3; §5 search meta → Task 3 (3d); §6 file layout & i18n → Tasks 1–2; §8 tests → each task's test steps + Task 4.
- **Depth ≥ 2 breadcrumb rule** is implemented in Task 2 step 5b (`stack.length >= 2`) and pinned by the depth-1 (absent) and depth-2 (present) tests.
- **Type consistency:** `renderProductRow(item, meta:string)` is defined in Task 3 step 3c and used with the same shape in 3d/3e; Task 2's intermediate copy keeps the OLD `(item, metaParts:array)` shape together with the OLD function — consistent within each task's end state.
- **Behavior freeze:** no changes to state, effects, `catalogService` call shapes, or `handleSelect`; verified by the untouched debounce/stale-response tests passing throughout.

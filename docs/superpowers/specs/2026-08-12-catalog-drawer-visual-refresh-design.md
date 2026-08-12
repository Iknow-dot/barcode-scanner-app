# Catalog drawer visual refresh (consultant side) — design

Date: 2026-08-12
Status: direction approved via mockups (`.claude/catalog-mockups.html`); spec pending user review

## 1. Problem

The unified "Find product" drawer (2026-07-24 rework) is functionally right but visually
reads like an admin settings list, not a product catalog:

- Categories render as bare text rows; products as a default Ant `List` with 36 px
  thumbnails. The two look identical — no hierarchy.
- Price — the number consultants need most — sits in the muted 12 px meta line.
- A product with no photo (common: many 1C items have none, and `ProductImage`
  deliberately renders nothing on load failure) collapses to a text-only row, so the
  list looks broken-in-places rather than designed-for-missing-images.

## 2. Decision (made with the user)

Three directions were mocked up in `.claude/catalog-mockups.html`. The user chose
**Option A (rich product rows + subcategory chips) with Option C's category tiles at
the root**. This is a presentation-only change: search-first flow, scan button,
drill-down semantics, tap-product → live 1C price/stock fetch → `AddToCartSheet`, and
all API calls stay exactly as they are. **No backend changes.**

## 3. Root state (browse, drill-down stack empty)

Replaces the bare text rows for top-level categories:

- Small uppercase caption ("კატეგორიები" — new i18n key) above a **2-column tile
  grid** of the root categories.
- Each tile: pastel **gradient background assigned deterministically** (hash of the
  category id → fixed palette of ~6 gradients), a large low-opacity **monogram**
  (first character of the category name, top-right) as the decorative element, the
  category name (bold, clamped to 2 lines), and a `N პროდუქტი` count line
  (`product_count` from the tree endpoint).
  - Monogram, not emoji: category names come from 1C and are arbitrary, so no icon
    mapping is possible. The hash palette keeps a tile's color stable across visits.
- Tapping a tile descends one level (same `setStack` behavior as today's rows).
- No product list at the root (unchanged — it would be the whole catalog).

## 4. Drilled state (browse, stack non-empty)

- **Crumb header** replaces the breadcrumb-text + link-button pair:
  - a **back pill** labeled with the parent level (`‹ ყველა კატეგორია` at depth 1,
    else the parent category name) — ascends exactly one level, same as today;
  - the current category name, bold, beside it;
  - the branch product count right-aligned (`N პროდუქტი`, from the tree node's
    `product_count`).
  - The tiny full-path breadcrumb line (`ყველა კატეგორია › …`) is kept only at
    depth ≥ 2, where the back pill alone no longer shows where you are.
- **Subcategory chips**: the current node's children render as a horizontal
  chip scroller (`name  count`), replacing the full-width subcategory rows. Tapping a
  chip descends. No children → no chips row.
- **Product rows** become card rows (white card, 12 px radius, one per product):
  - 56 px rounded thumbnail. Markup is a tinted placeholder box (box-icon SVG on
    accent-at-6% background) with the `ProductImage` absolutely positioned over it —
    a loaded photo covers the placeholder; a missing/failed one reveals it.
    `ProductImage` itself is unchanged.
  - Name at weight 600, clamped to 2 lines.
  - Meta line: article, plus the product's category path when it lies deeper than
    the current node (branch listings are subtree-wide, so the path tells apart
    products pulled up from different subcategories).
  - Price right-aligned, bold, tabular numerals, `N ₾`.
  - A small rounded "+" affordance on the right. **It is visual only** — the whole
    row remains one tap target invoking the same `onSelectProduct(sku)`; no separate
    quick-add path (stock/price are unknown until the live 1C fetch).
- The uppercase "პროდუქტები · N" caption is dropped — the count lives in the crumb
  header. Load-more stays the same block button (`მეტის ჩვენება`).

## 5. Search state (query non-empty)

Same card rows as §4, with the meta line extended to `article · category path`
(what the search endpoint already returns). Debounce, result cap, `Spin`/`Empty`
states, and clear-query-returns-to-browse behavior are unchanged.

## 6. Implementation shape

- **`FindProductDrawer.css`** (new, following the `BarcodeScanner.css` precedent,
  `fpd-` class prefix): tile grid + gradients, chip scroller (hidden scrollbar),
  card rows, 2-line clamp, crumb header. Inline styles in the drawer shrink
  accordingly.
- **`categoryTileStyle.js`** (new pure helper beside `catalogBrowse.js`):
  `paletteIndex(id)` (stable hash → palette bound) and `monogram(name)`
  (first character; empty-safe). Unit-tested like the other pure helpers.
- **`FindProductDrawer.js`**: root/subcategory Ant `List`s and `renderProductRow`
  are replaced with plain mapped divs using the new classes (the custom card markup
  no longer benefits from `List`); Drawer/Input/Button/Switch/Spin/Empty stay Ant.
  All state, effects, sequencing tokens, and callbacks are untouched.
- **i18n** (`translations.js`, both ka/en): add `categoriesLabel`
  ('კატეგორიები' / 'Categories') and `productCountSuffix`
  ('პროდუქტი' / 'products', rendered as `${n} ${t.productCountSuffix}`).
  `productsLabel` is no longer used by the drawer; the key stays (other views may
  reference it — verified during implementation).

## 7. Out of scope

- Backend: nothing changes (endpoints, serializers, counts all reused as-is).
- No stock or availability in list rows — live stock still appears only after
  selecting a product (unchanged funnel).
- Admin Catalog tab, scanner overlay, cart, order flow: untouched.
- No grid/list view toggle (Option B / C-inner toggle can layer on later without
  redoing this).
- No dark-theme variant (the app ships a single light theme).

## 8. Testing

- **Unit:** `categoryTileStyle` — hash stability, palette bounds, monogram for
  Georgian / Latin / empty names.
- **Component (`FindProductDrawer.test.js`):** root renders tiles with counts;
  drilled state renders chips for children and card rows with article + price;
  missing image renders the placeholder box; tile/chip/row taps drive the same
  stack/`onSelectProduct` behavior as before (existing interaction tests keep
  passing).
- **Manual:** exercise root → drill → search → select against the dev stack
  (mock-1C + runserver + frontend) before completion.

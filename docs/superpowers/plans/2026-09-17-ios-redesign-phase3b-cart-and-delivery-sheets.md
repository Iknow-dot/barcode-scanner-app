# iOS Redesign Phase 3b — Cart and Delivery Sheets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the active order's drawer (`OrderPanel` with antd Steps and card tables) with a two-step iOS order sheet: the cart (client row, products grouped by warehouse with one stepper, the gift pill and an inline price/discount editor per row, total and "შემდეგი") and delivery (pickup/delivery segments, inline delivery fields, an order summary and "შეკვეთის დადასტურება"), with save for later, change customer and delete order in a ⋯ menu.

**Architecture:** `OrderSheet` hosts one `IosSheet` (phase 3a) whose navbar, content and bottom bar switch between the two steps (no nested drawers). It keeps `OrderPanel`'s local-order pattern — edits update local state and report to the dashboard through a ref, so the dashboard does not re-render per edit. Pure modules carry the logic and are unit-tested: `cartSheetView` (warehouse sections, SKU grouping and gift pairing, counts, row pricing, quantity plans, step headers) and `deliveryView` (delivery rules). Every request, payload and validation is today's, moved: `CartItemRow` from `CartTableRow`, `DeliveryStep` from `DeliverySection` + `NotesSection`, `useSkuStock` from the group card's stock fetch, `useDebouncedField` unchanged.

**Tech Stack:** React 18 (CRA 5), antd 6.3.1, plain CSS on the `--if-*` tokens, Jest 27 + Testing Library via react-scripts.

**Spec:** `docs/superpowers/specs/2026-09-17-ios-redesign-phase3-order-sheets-design.md` (sections marked 3b)

**Prerequisite:** `docs/superpowers/plans/2026-09-17-ios-redesign-phase3a-product-sheet.md` is fully implemented and committed (its Task 10 set the spec status to "3a implemented"). Check with `git log --oneline -12` before starting; if 3a's commits are missing, stop and report.

## Global Constraints

- Work in place on branch `djangoRewrite`. Another session has uncommitted work in this checkout (`src/index.js`, `public/index.html`, `src/api/client.js`, `src/components/Auth/AuthContext.js`, `src/observability/*`, `src/config/`, `.env.production`, `docker/`, Dockerfiles, `backend/`, `docker-compose.yml`, `.github/workflows/*`, `CLAUDE.md`, `docs/architecture/06-monitoring.md`, `deploy/`, `docs/releasing.md`). Never edit, stage or revert those files. Stage by exact path only — never `git add -A`, `git add .` or a directory. Before each commit run `git diff --cached --name-only` and confirm it lists only the task's files. If `.git/rebase-merge` or `.git/MERGE_HEAD` exists, stop and report.
- All frontend commands run from `barcode-scanner-frontend/`. Git commands run from the repo root.
- Run tests with `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false <pattern>`. Never drop `--openssl-legacy-provider`; never use bare `npx jest`.
- Baseline after phase 3a: **63 suites, 417 tests** passing (56 / 351 before phase 3, including 2 suites of the other session's). Expected totals below assume nobody else adds tests meanwhile; if they do, the difference from the baseline is what must match.
- Colours only through `var(--if-*)` tokens. The only literals allowed in `ios.css`: `#fff` as text or an icon on a `--if-tint` fill, `rgba(58, 152, 102, a)` in coloured shadows, `rgba(0, 0, 0, a)` in neutral shadows and masks. Prices and totals use `--if-label`, never the accent.
- `theme/ios.css` is loaded after `index.css`, so an `index.css` rule that changes an `.if-*` primitive carries both classes.
- Every new user-visible string goes through `t` with a `ka` and an `en` value. Icon-only buttons carry `aria-label`. Controls are real `<button type="button">` elements.
- No backend changes. No change to order, stock, gift, discount or offline business rules: the same requests and payloads as `OrderPanel`, only the controls move.
- Several files use CRLF line endings (`index.css`, `ios.css`, `UserDashboard.js`, `translations.js`, `GiftCounter.js`, `GiftCounter.test.js`). Do not convert line endings; the Edit tool matches the old text below regardless. Line numbers drift: always locate edits by the quoted old text.
- antd renders under jsdom with a few harmless console lines this plan expects: `Warning: \`NaN\` is an invalid value for the \`height\` css style property` from `TextArea autoSize` in the `DeliveryStep` and `OrderSheet` suites. Any other `console.error` (especially "not wrapped in act(...)") is a defect in the task.
- Commit message trailer (second `-m`): `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Cart and delivery strings, the pill toggle and form-row primitives

**Files:**
- Modify: `barcode-scanner-frontend/src/i18n/translations.js`
- Modify: `barcode-scanner-frontend/src/theme/ios.css`

**Interfaces:**
- Produces: translation keys in `ka` and `en`: `productsInWarehouse(n)`, `piecesCount(n)` (functions), `optional`, `notSet` (strings).
- Produces (global CSS): `.if-pill` (`.is-on`), `.if-field-label`, `.if-field-hint`, `.if-field-input.ant-input` / `.if-field-input.ant-picker` (borderless inline fields inside a row).

- [ ] **Step 1: Add the strings**

In `barcode-scanner-frontend/src/i18n/translations.js`, replace (Georgian block):

```js
        cartTotalCount: (n) => `სულ · ${n} ცალი`,
```

with:

```js
        cartTotalCount: (n) => `სულ · ${n} ცალი`,
        productsInWarehouse: (n) => `${n} პროდუქტი`,
        piecesCount: (n) => `${n} ცალი`,
        optional: 'არასავალდებულო',
        notSet: 'არ არის მითითებული',
```

and replace (English block):

```js
        cartTotalCount: (n) => `Total · ${n} pcs`,
```

with:

```js
        cartTotalCount: (n) => `Total · ${n} pcs`,
        productsInWarehouse: (n) => `${n} ${n === 1 ? 'product' : 'products'}`,
        piecesCount: (n) => `${n} pcs`,
        optional: 'Optional',
        notSet: 'Not set',
```

Then confirm none of the four keys already existed: `grep -cE "^\s+(productsInWarehouse|piecesCount|optional|notSet):" src/i18n/translations.js`
Expected: `8`.

- [ ] **Step 2: Add the primitives**

In `barcode-scanner-frontend/src/theme/ios.css`, replace (the last rule of the file, added in phase 3a):

```css
.if-sheet-total-value.is-muted {
    color: var(--if-label-3);
}
```

with:

```css
.if-sheet-total-value.is-muted {
    color: var(--if-label-3);
}

/* ---------- Pill toggle (the gift marker on a cart row) ---------- */
.if-pill {
    flex: none;
    height: 44px;
    padding: 0 14px;
    border: 0;
    border-radius: 22px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--if-fill);
    color: var(--if-label-2);
    font-family: inherit;
    font-size: 13px;
    line-height: 16px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}

.if-pill.is-on {
    background: var(--if-tint-soft);
    color: var(--if-tint-text);
}

.if-pill:focus-visible {
    outline: 2px solid var(--if-tint);
    outline-offset: 2px;
}

/* ---------- Form rows (label above an inline, borderless field) ---------- */
.if-field-label {
    display: block;
    font-size: 13px;
    line-height: 18px;
    color: var(--if-label-2);
}

.if-field-hint {
    font-size: 13px;
    line-height: 18px;
    color: var(--if-label-3);
}

.if-field-input.ant-input,
.if-field-input.ant-picker {
    width: 100%;
    margin-top: 2px;
    padding: 0;
    border-radius: 0;
    font-size: 17px;
    line-height: 22px;
    color: var(--if-label);
    background: transparent;
    box-shadow: none;
}

.if-field-input.ant-picker .ant-picker-input > input {
    font-size: 17px;
    line-height: 22px;
}
```

- [ ] **Step 3: Run the theme tests and the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/theme`
Expected: PASS — `iosCss.test.js` 5 tests (no colour literal, every token exists), `palette.test.js` 30, `antdTheme.test.js` 10, `noLegacyBlue.test.js` 4.

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 63 suites, 417 tests.

- [ ] **Step 4: Commit**

```bash
git add barcode-scanner-frontend/src/i18n/translations.js barcode-scanner-frontend/src/theme/ios.css
git diff --cached --name-only
git commit -m "feat(order-sheet): add cart and delivery strings, the pill toggle and form-row primitives" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Cart view model

**Files:**
- Create: `barcode-scanner-frontend/src/components/UserDashboard/cartSheetView.js`
- Test: `barcode-scanner-frontend/src/components/UserDashboard/cartSheetView.test.js`

**Interfaces:**
- Consumes: `groupItemsBySku` (default export of `./groupItemsBySku`) and `pairGiftLines` (from `./giftSplit`), both unchanged.
- Produces (named exports): `cartSections(items) => [{key, warehouseName, rows: Row[]}]` where a `Row` is a `pairGiftLines` row plus `key` (unique in its section), `sku`, `article`; `cartItemCount(items)`, `cartGiftCount(items)`, `orderWarehouseNames(items)`, `customerInitials(name)`; `cartRowView(row) => {anchor, name, price, effectivePrice, hasDiscount, discountPercent, priceCap, lineTotal, pending, minQuantity}`; `planQuantityChange(row, newTotal) => {itemId, data: {quantity}} | null`; `pricePatch(value)`, `discountPatch(value)`; `exceedsStock(row, stock)`; `orderStepHeader(step, t) => {title, subtitle, leading: 'close' | 'back'}`; `hasOrderItems(order)`.

- [ ] **Step 1: Write the failing test**

Create `barcode-scanner-frontend/src/components/UserDashboard/cartSheetView.test.js`:

```js
import translations from '../../i18n/translations';
import {
    cartGiftCount,
    cartItemCount,
    cartRowView,
    cartSections,
    customerInitials,
    discountPatch,
    exceedsStock,
    hasOrderItems,
    orderStepHeader,
    orderWarehouseNames,
    planQuantityChange,
    pricePatch,
} from './cartSheetView';

const en = translations.en;

const line = (overrides) => ({
    id: 1,
    sku: 'PAN',
    sku_name: 'Granite pan',
    article: 'MG-2814',
    warehouse_code: 'W1',
    warehouse_name: 'Vake',
    quantity: '1',
    price: '89.90',
    effective_price: '89.90',
    discount_percent: '0.00',
    discounted_price: null,
    line_total: '89.90',
    is_gift: false,
    unit: 'piece',
    ...overrides,
});

const PAN_PAID = line({id: 1, quantity: '2', line_total: '179.80'});
const PAN_GIFT = line({id: 2, quantity: '1', is_gift: true, line_total: '0.00'});
const KETTLE = line({id: 3, sku: 'KETTLE', sku_name: 'Kettle', article: 'EK-1700', price: '119.50', effective_price: '119.50', line_total: '119.50'});
const PAN_CENTRAL = line({id: 4, warehouse_code: 'W2', warehouse_name: 'Central'});

describe('cartSections', () => {
    it('groups rows by warehouse in order of first appearance', () => {
        const sections = cartSections([PAN_PAID, PAN_CENTRAL, KETTLE, PAN_GIFT]);
        expect(sections.map((s) => s.warehouseName)).toEqual(['Vake', 'Central']);
        expect(sections[0].rows.map((r) => r.sku)).toEqual(['PAN', 'KETTLE']);
        expect(sections[1].rows.map((r) => r.sku)).toEqual(['PAN']);
    });

    it('pairs the paid and gift lines of a product into one row', () => {
        const [vake] = cartSections([PAN_PAID, PAN_GIFT]);
        expect(vake.rows).toHaveLength(1);
        expect(vake.rows[0]).toMatchObject({totalQty: 3, giftQty: 1});
        expect(vake.rows[0].paid.id).toBe(1);
        expect(vake.rows[0].gift.id).toBe(2);
    });

    it('gives every row a key unique within its section', () => {
        const [vake] = cartSections([PAN_PAID, KETTLE]);
        expect(new Set(vake.rows.map((r) => r.key)).size).toBe(2);
    });

    it('is empty for an order without items', () => {
        expect(cartSections([])).toEqual([]);
        expect(cartSections(undefined)).toEqual([]);
    });
});

describe('order counts', () => {
    const items = [PAN_PAID, PAN_GIFT, KETTLE];

    it('counts units, gifts included, and gift units alone', () => {
        expect(cartItemCount(items)).toBe(4);
        expect(cartGiftCount(items)).toBe(1);
        expect(cartItemCount(undefined)).toBe(0);
    });

    it('lists each warehouse once', () => {
        expect(orderWarehouseNames([PAN_PAID, PAN_CENTRAL, KETTLE])).toEqual(['Vake', 'Central']);
    });

    it('knows whether the order has items', () => {
        expect(hasOrderItems({items})).toBe(true);
        expect(hasOrderItems({items: []})).toBe(false);
        expect(hasOrderItems(null)).toBe(false);
    });
});

describe('customerInitials', () => {
    it('takes the first letters of the first two words', () => {
        expect(customerInitials('გიორგი ბერიძე')).toBe('გბ');
        expect(customerInitials('  anna  maria lee ')).toBe('AM');
        expect(customerInitials('')).toBe('');
    });
});

describe('cartRowView', () => {
    it('reads price, discount, line total and the quantity floor', () => {
        const [vake] = cartSections([
            {...PAN_PAID, effective_price: '80.91', discount_percent: '10.00', line_total: '161.82'},
            PAN_GIFT,
        ]);
        expect(cartRowView(vake.rows[0])).toMatchObject({
            name: 'Granite pan',
            price: '89.90',
            effectivePrice: '80.91',
            hasDiscount: true,
            discountPercent: 10,
            priceCap: 89.9,
            lineTotal: '161.82',
            pending: false,
            minQuantity: 2,
        });
    });

    it('flags lines still waiting to sync', () => {
        const [vake] = cartSections([{...PAN_PAID, id: 'tmp_abc'}]);
        expect(cartRowView(vake.rows[0]).pending).toBe(true);
    });

    it('anchors a gift-only row on its gift line', () => {
        const [vake] = cartSections([PAN_GIFT]);
        expect(cartRowView(vake.rows[0])).toMatchObject({minQuantity: 1, anchor: PAN_GIFT});
    });
});

describe('planQuantityChange', () => {
    const [vake] = cartSections([PAN_PAID, PAN_GIFT]);
    const row = vake.rows[0];

    it('moves the change onto the paid line and keeps the gifts', () => {
        expect(planQuantityChange(row, 5)).toEqual({itemId: 1, data: {quantity: 4}});
    });

    it('refuses a total that leaves no paid unit', () => {
        expect(planQuantityChange(row, 1)).toBeNull();
        expect(planQuantityChange(row, 0)).toBeNull();
    });
});

describe('price edits', () => {
    it('clears the percent when a price is set and the price when a percent is set', () => {
        expect(pricePatch(80)).toEqual({discounted_price: 80, discount_percent: 0});
        expect(pricePatch(null)).toEqual({discounted_price: null, discount_percent: 0});
        expect(discountPatch(5)).toEqual({discount_percent: 5, discounted_price: null});
        expect(discountPatch(null)).toEqual({discount_percent: 0, discounted_price: null});
    });
});

describe('exceedsStock', () => {
    it('warns only when a known stock is below the row total', () => {
        const [vake] = cartSections([PAN_PAID]);
        expect(exceedsStock(vake.rows[0], 1)).toBe(true);
        expect(exceedsStock(vake.rows[0], 2)).toBe(false);
        expect(exceedsStock(vake.rows[0], undefined)).toBe(false);
    });
});

describe('orderStepHeader', () => {
    it('titles step one as the cart and step two as delivery', () => {
        expect(orderStepHeader(1, en)).toEqual({title: en.cart, subtitle: `1 / 2 · ${en.stepProducts}`, leading: 'close'});
        expect(orderStepHeader(2, en)).toEqual({title: en.stepDelivery, subtitle: '2 / 2', leading: 'back'});
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/UserDashboard/cartSheetView`
Expected: FAIL — `Cannot find module './cartSheetView'`.

- [ ] **Step 3: Create `cartSheetView.js`**

Create `barcode-scanner-frontend/src/components/UserDashboard/cartSheetView.js`:

```js
import groupItemsBySku from './groupItemsBySku';
import {pairGiftLines} from './giftSplit';

/**
 * The cart as the order sheet lists it: one section per warehouse, in the
 * order warehouses first appear in the order. Inside a section the lines are
 * grouped by SKU (groupItemsBySku) and each product's paid and gift lines are
 * paired into one visual row (pairGiftLines), as the per-product card did.
 */
export const cartSections = (items) => {
    const list = Array.isArray(items) ? items : [];
    const codes = [];
    const byWarehouse = new Map();
    list.forEach((item) => {
        const code = item.warehouse_code || '';
        if (!byWarehouse.has(code)) {
            codes.push(code);
            byWarehouse.set(code, []);
        }
        byWarehouse.get(code).push(item);
    });
    return codes.map((code) => {
        const sectionItems = byWarehouse.get(code);
        const rows = groupItemsBySku(sectionItems).flatMap((group) => (
            pairGiftLines(group.items).map((row) => ({
                ...row,
                key: `${group.sku}:${row.key}`,
                sku: group.sku,
                article: group.article,
            }))
        ));
        return {
            key: code || '—',
            warehouseName: sectionItems[0].warehouse_name || code,
            rows,
        };
    });
};

const quantityOf = (item) => Number(item.quantity || 0);

/** Units in the order ("Total · 4 pcs"), gifts included. */
export const cartItemCount = (items) => (
    (Array.isArray(items) ? items : []).reduce((sum, item) => sum + quantityOf(item), 0)
);

/** Units marked as gifts. */
export const cartGiftCount = (items) => (
    (Array.isArray(items) ? items : []).reduce((sum, item) => sum + (item.is_gift ? quantityOf(item) : 0), 0)
);

/** Distinct warehouse names, in order of first appearance. */
export const orderWarehouseNames = (items) => [
    ...new Set((Array.isArray(items) ? items : []).map((item) => item.warehouse_name).filter(Boolean)),
];

// Uppercase a letter, except Georgian: toUpperCase() turns Mkhedruli (the
// script Georgian is written in) into Mtavruli capitals, which are not used
// for initials.
const initial = (word) => {
    const letter = word.charAt(0);
    const upper = letter.toUpperCase();
    return /[Ა-Ჿ]/.test(upper) ? letter : upper;
};

/** Avatar initials: the first letter of the first two words. */
export const customerInitials = (name) => (
    (name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(initial).join('')
);

const isPendingLine = (line) => Boolean(line) && (line._pending === true || String(line.id).startsWith('tmp_'));

/**
 * Display and edit model for one cart row. The anchor line carries price and
 * discount edits and quantity growth: the paid line when there is one,
 * otherwise the gift line. The minimum total keeps every gift unit plus one
 * paid unit (gifts shrink through the gift stepper instead).
 */
export const cartRowView = (row) => {
    const anchor = row.paid ?? row.gift;
    return {
        anchor,
        name: anchor.sku_name || anchor.sku,
        price: anchor.price,
        effectivePrice: anchor.effective_price ?? anchor.price,
        hasDiscount: Boolean(anchor.effective_price)
            && parseFloat(anchor.effective_price) !== parseFloat(anchor.price),
        discountPercent: parseFloat(anchor.discount_percent || 0),
        priceCap: parseFloat(anchor.price || 0),
        lineTotal: (Number(row.paid?.line_total || 0) + Number(row.gift?.line_total || 0)).toFixed(2),
        pending: isPendingLine(row.paid) || isPendingLine(row.gift),
        minQuantity: row.paid ? row.giftQty + 1 : 1,
    };
};

/**
 * The request behind a new row total: the anchor line absorbs the change and
 * the gift count stays. null when the total would drop below one paid unit.
 */
export const planQuantityChange = (row, newTotal) => {
    if (newTotal < 1) return null;
    const target = row.paid ?? row.gift;
    const quantity = newTotal - (row.paid ? row.giftQty : 0);
    if (quantity < 1) return null;
    return {itemId: target.id, data: {quantity}};
};

/** A manual price replaces any percent discount, and the reverse. */
export const pricePatch = (value) => ({discounted_price: value == null ? null : value, discount_percent: 0});
export const discountPatch = (value) => ({discount_percent: value == null ? 0 : value, discounted_price: null});

export const exceedsStock = (row, stock) => Number.isFinite(stock) && Number(row.totalQty) > Number(stock);

/** Navbar of the order sheet for each of its two steps. */
export const orderStepHeader = (step, t) => (
    step === 2
        ? {title: t.stepDelivery, subtitle: '2 / 2', leading: 'back'}
        : {title: t.cart, subtitle: `1 / 2 · ${t.stepProducts}`, leading: 'close'}
);

export const hasOrderItems = (order) => Array.isArray(order?.items) && order.items.length > 0;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/UserDashboard/cartSheetView`
Expected: PASS — 16 tests. (If `customerInitials` returns `ᲒᲑ` for `'გიორგი ბერიძე'`, the Mtavruli guard is missing: `toUpperCase()` maps Georgian Mkhedruli to Mtavruli capitals.)

- [ ] **Step 5: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 64 suites, 433 tests.

- [ ] **Step 6: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/cartSheetView.js barcode-scanner-frontend/src/components/UserDashboard/cartSheetView.test.js
git diff --cached --name-only
git commit -m "feat(order-sheet): add the cart view model" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Gift marker as an iOS pill

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/GiftCounter.js` (whole file)
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/GiftCounter.test.js`

**Interfaces:**
- Keeps: default export `GiftCounter({enabled, totalQty, giftQty, onChange: (absoluteGiftCount) => void, label})` and its accessible names (`label`, `` `${label} −` ``, `` `${label} +` ``), so the existing 6 tests stay unchanged.
- Changes: the pill is `.if-pill` (`.is-on` and `aria-pressed` when any unit is a gift) with the `gift` / `check` glyph; the split stepper (`.if-stepper`) shows only when the row has more than one unit. The gift pinks (`.m-gift-*`) are no longer used (deleted in Task 8).

- [ ] **Step 1: Write the failing test**

In `barcode-scanner-frontend/src/components/UserDashboard/GiftCounter.test.js`, replace:

```js
  it('hides the mini stepper when nothing is gifted', () => {
    render(<GiftCounter enabled totalQty={2} giftQty={0} onChange={() => {}} label="Gift"/>);
    expect(screen.queryByRole('button', {name: 'Gift +'})).toBeNull();
  });
```

with:

```js
  it('hides the mini stepper when nothing is gifted', () => {
    render(<GiftCounter enabled totalQty={2} giftQty={0} onChange={() => {}} label="Gift"/>);
    expect(screen.queryByRole('button', {name: 'Gift +'})).toBeNull();
  });

  it('toggles a single unit as a whole, with no split stepper', () => {
    const onChange = jest.fn();
    render(<GiftCounter enabled totalQty={1} giftQty={1} onChange={onChange} label="Gift"/>);
    const pill = screen.getByRole('button', {name: 'Gift'});
    expect(pill).toHaveAttribute('aria-pressed', 'true');
    expect(pill).toHaveTextContent(/^Gift$/);
    expect(screen.queryByRole('button', {name: 'Gift +'})).toBeNull();
    fireEvent.click(pill);
    expect(onChange).toHaveBeenCalledWith(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/UserDashboard/GiftCounter`
Expected: FAIL — `toggles a single unit as a whole…` (no `aria-pressed` attribute); the other 6 pass.

- [ ] **Step 3: Replace `GiftCounter.js`**

Replace the whole contents of `barcode-scanner-frontend/src/components/UserDashboard/GiftCounter.js` with:

```js
import React from 'react';
import IosIcon from '../Common/IosIcon';

/**
 * Gift marker for a cart row (ClickUp 86ca495uu): a pill that toggles the
 * gift, plus a small stepper for how many units are gifts when the row has
 * more than one unit. Rendered only when the org has gift marking enabled;
 * the backend independently enforces GIFT_NOT_ENABLED.
 *
 * onChange receives the desired ABSOLUTE gift count (0..totalQty); the
 * caller translates it into line splits via planGiftChange.
 */
const GiftCounter = ({enabled, totalQty, giftQty, onChange, label}) => {
    if (!enabled) return null;
    const gifted = giftQty > 0;
    const showSplit = gifted && totalQty > 1;
    return (
        <div className="m-gift">
            <button
                type="button"
                className={`if-pill${gifted ? ' is-on' : ''}`}
                aria-pressed={gifted}
                onClick={() => onChange(gifted ? 0 : 1)}
                aria-label={label}
                title={label}
            >
                <IosIcon name={gifted ? 'check' : 'gift'} size={16} stroke={gifted ? 2.6 : 2}/>
                <span>{showSplit ? `${giftQty}/${totalQty} ${label}` : label}</span>
            </button>
            {showSplit && (
                <span className="if-stepper">
                    <button type="button" className="if-stepper-btn" aria-label={`${label} −`}
                            onClick={() => onChange(giftQty - 1)}>
                        <IosIcon name="minus" size={18} stroke={2.4}/>
                    </button>
                    <span className="m-gift-count">{giftQty} / {totalQty}</span>
                    <button type="button" className="if-stepper-btn" aria-label={`${label} +`}
                            disabled={giftQty >= totalQty}
                            onClick={() => onChange(giftQty + 1)}>
                        <IosIcon name="plus" size={18} stroke={2.4}/>
                    </button>
                </span>
            )}
        </div>
    );
};

export default GiftCounter;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/UserDashboard/GiftCounter`
Expected: PASS — 7 tests.

- [ ] **Step 5: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 64 suites, 434 tests.

- [ ] **Step 6: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/GiftCounter.js barcode-scanner-frontend/src/components/UserDashboard/GiftCounter.test.js
git diff --cached --name-only
git commit -m "feat(order-sheet): restyle the gift marker as an iOS pill" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Cart row

**Files:**
- Create: `barcode-scanner-frontend/src/components/UserDashboard/CartItemRow.js`
- Test: `barcode-scanner-frontend/src/components/UserDashboard/CartItemRow.test.js`

**Interfaces:**
- Consumes: `orderService.updateOrderItem` / `removeOrderItem` / (through `applyGiftOps`) `addOrderItem` from `../../api`; `planGiftChange`, `applyGiftOps` from `./giftSplit`; `QuantityStepper` (with `minSlot`, 3a); `GiftCounter` (Task 3); `unitLabel` (3a `productSheetView`); `cartRowView`, `planQuantityChange`, `pricePatch`, `discountPatch`, `exceedsStock` (Task 2); keys `overridePrice`, `price`, `discountPercent`, `stockRemaining`, `exceedsStock(n)`, `offlineItemPending`, `quantity`, `decreaseQuantity`, `increaseQuantity`, `giftLabel`, `confirmDelete`, `yes`, `no`, `delete`, `orderError`.
- Produces: default export (memoized) `CartItemRow({row, stock: number | undefined, orderId, onOrderUpdate: (order) => void, notify, canApplyDiscount, maxDiscountPercent, giftEnabled})`. Classes it renders (styled in Task 6): `.m-cart-item` (`.is-pending`), `.m-cart-item-head`, `.m-cart-item-total`, `.m-cart-item-price` (`.is-editable`), `.m-cart-item-was`, `.m-cart-item-editor`, `.m-cart-item-field`, `.m-cart-item-captions`, `.m-cart-item-warning`, `.m-cart-item-pending`, `.m-cart-item-controls`, `.m-cart-item-delete`, and GiftCounter's `.m-gift`, `.m-gift-count`.

- [ ] **Step 1: Write the failing test**

Create `barcode-scanner-frontend/src/components/UserDashboard/CartItemRow.test.js`:

```js
import React from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import CartItemRow from './CartItemRow';
import {cartSections} from './cartSheetView';
import {orderService} from '../../api';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';

jest.mock('../../api', () => ({
    orderService: {
        updateOrderItem: jest.fn(),
        removeOrderItem: jest.fn(),
        addOrderItem: jest.fn(),
    },
}));

const en = translations.en;

// jsdom lacks these browser APIs that antd's Popconfirm and InputNumber touch.
beforeAll(() => {
    window.matchMedia = window.matchMedia || ((query) => ({
        matches: false, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
    }));
    global.ResizeObserver = global.ResizeObserver || class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
});

const line = (overrides) => ({
    id: 11,
    sku: 'PAN',
    sku_name: 'Granite pan',
    article: 'MG-2814',
    warehouse_code: 'W1',
    warehouse_name: 'Vake',
    quantity: '2',
    price: '89.90',
    effective_price: '89.90',
    discount_percent: '0.00',
    discounted_price: null,
    line_total: '179.80',
    is_gift: false,
    unit: 'piece',
    ...overrides,
});

const rowFor = (items) => cartSections(items)[0].rows[0];
const UPDATED = {id: 7, items: []};

const renderRow = (props = {}) => {
    const handlers = {onOrderUpdate: jest.fn(), notify: {error: jest.fn()}};
    render(
        <LanguageProvider>
            <CartItemRow
                row={rowFor([line()])}
                stock={5}
                orderId={7}
                canApplyDiscount={false}
                maxDiscountPercent={0}
                giftEnabled
                {...handlers}
                {...props}
            />
        </LanguageProvider>
    );
    return handlers;
};

describe('CartItemRow', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
        jest.clearAllMocks();
        orderService.updateOrderItem.mockResolvedValue({success: true, data: UPDATED});
        orderService.removeOrderItem.mockResolvedValue({success: true, data: UPDATED});
    });

    afterEach(() => {
        localStorage.removeItem('language');
    });

    it('shows the product, its line total, unit price and stock', () => {
        renderRow();
        expect(screen.getByText('Granite pan')).toBeInTheDocument();
        expect(screen.getByText('179.80 ₾')).toBeInTheDocument();
        expect(screen.getByText('89.90 ₾ / Piece')).toBeInTheDocument();
        expect(screen.getByText(`${en.stockRemaining}: 5`)).toBeInTheDocument();
    });

    it('changes the quantity through the paid line', async () => {
        const {onOrderUpdate} = renderRow();
        fireEvent.click(screen.getByRole('button', {name: en.increaseQuantity}));
        await waitFor(() => expect(onOrderUpdate).toHaveBeenCalledWith(UPDATED));
        expect(orderService.updateOrderItem).toHaveBeenCalledWith(7, 11, {quantity: 3});
    });

    it('turns minus into delete at one paid unit', () => {
        renderRow({row: rowFor([line({quantity: '1', line_total: '89.90'})])});
        expect(screen.queryByRole('button', {name: en.decreaseQuantity})).toBeNull();
        expect(screen.getByRole('button', {name: en.delete})).toBeInTheDocument();
    });

    it('keeps minus, not delete, above the minimum', () => {
        renderRow();
        expect(screen.getByRole('button', {name: en.decreaseQuantity})).not.toBeDisabled();
        expect(screen.queryByRole('button', {name: en.delete})).toBeNull();
    });

    it('marks the row as a gift through the gift pill', async () => {
        const {onOrderUpdate} = renderRow({row: rowFor([line({quantity: '1', line_total: '89.90'})])});
        fireEvent.click(screen.getByRole('button', {name: en.giftLabel}));
        await waitFor(() => expect(onOrderUpdate).toHaveBeenCalledWith(UPDATED));
        expect(orderService.updateOrderItem).toHaveBeenCalledWith(7, 11, {is_gift: true});
    });

    it('has no gift pill when the org has gifts off', () => {
        renderRow({giftEnabled: false});
        expect(screen.queryByRole('button', {name: en.giftLabel})).toBeNull();
    });

    it('deletes both lines of the row after confirming', async () => {
        const row = rowFor([line({quantity: '1', line_total: '89.90'}), line({id: 12, quantity: '1', is_gift: true, line_total: '0.00'})]);
        const {onOrderUpdate} = renderRow({row});
        fireEvent.click(screen.getByRole('button', {name: en.delete}));
        fireEvent.click(await screen.findByRole('button', {name: en.yes}));
        await waitFor(() => expect(onOrderUpdate).toHaveBeenCalledWith(UPDATED));
        expect(orderService.removeOrderItem).toHaveBeenCalledWith(7, 11);
        expect(orderService.removeOrderItem).toHaveBeenCalledWith(7, 12);
    });

    it('offers no price editor to a user who may not discount', () => {
        renderRow({canApplyDiscount: false});
        expect(screen.queryByRole('button', {name: new RegExp(en.overridePrice)})).toBeNull();
        expect(screen.queryByRole('spinbutton')).toBeNull();
    });

    it('lets a user who may discount override the price', async () => {
        const {onOrderUpdate} = renderRow({canApplyDiscount: true, maxDiscountPercent: 20});
        fireEvent.click(screen.getByRole('button', {name: new RegExp(en.overridePrice)}));
        const price = screen.getByRole('spinbutton', {name: en.price});
        fireEvent.change(price, {target: {value: '80'}});
        fireEvent.blur(price);
        await waitFor(() => expect(onOrderUpdate).toHaveBeenCalledWith(UPDATED));
        expect(orderService.updateOrderItem).toHaveBeenCalledWith(7, 11, {discounted_price: 80, discount_percent: 0});
    });

    it('lets a user who may discount set a percent, and skips an unchanged field', async () => {
        const {onOrderUpdate} = renderRow({canApplyDiscount: true, maxDiscountPercent: 20});
        fireEvent.click(screen.getByRole('button', {name: new RegExp(en.overridePrice)}));
        fireEvent.blur(screen.getByRole('spinbutton', {name: en.price}));
        expect(orderService.updateOrderItem).not.toHaveBeenCalled();
        const discount = screen.getByRole('spinbutton', {name: en.discountPercent});
        fireEvent.change(discount, {target: {value: '10'}});
        fireEvent.blur(discount);
        await waitFor(() => expect(onOrderUpdate).toHaveBeenCalledWith(UPDATED));
        expect(orderService.updateOrderItem).toHaveBeenCalledWith(7, 11, {discount_percent: 10, discounted_price: null});
    });

    it('warns in words when the row exceeds the warehouse stock', () => {
        renderRow({stock: 1});
        expect(screen.getByText(en.exceedsStock(1))).toBeInTheDocument();
    });

    it('marks a line still waiting to sync', () => {
        renderRow({row: rowFor([line({id: 'tmp_x1', _pending: true})]), stock: undefined});
        expect(screen.getByText(en.offlineItemPending)).toBeInTheDocument();
    });

    it('reports a failed change', async () => {
        orderService.updateOrderItem.mockResolvedValue({success: false, error: 'nope'});
        const {notify, onOrderUpdate} = renderRow();
        fireEvent.click(screen.getByRole('button', {name: en.increaseQuantity}));
        await waitFor(() => expect(notify.error).toHaveBeenCalledWith(en.orderError, 'nope'));
        expect(onOrderUpdate).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/UserDashboard/CartItemRow`
Expected: FAIL — `Cannot find module './CartItemRow'`.

- [ ] **Step 3: Create `CartItemRow.js`**

Create `barcode-scanner-frontend/src/components/UserDashboard/CartItemRow.js`:

```js
import React, {memo, useCallback, useState} from 'react';
import {InputNumber, Popconfirm} from 'antd';
import {orderService} from '../../api';
import {useLanguage} from '../../i18n/LanguageContext';
import IosIcon from '../Common/IosIcon';
import QuantityStepper from '../Common/QuantityStepper';
import GiftCounter from './GiftCounter';
import {applyGiftOps, planGiftChange} from './giftSplit';
import {unitLabel} from './productSheetView';
import {
    cartRowView,
    discountPatch,
    exceedsStock,
    planQuantityChange,
    pricePatch,
} from './cartSheetView';

/**
 * One product in one warehouse on the cart sheet: its paid and gift lines
 * shown as a single row (see cartSheetView). Every control keeps the request
 * the old cart table row made: quantity through the anchor line, gifts
 * through planGiftChange, delete removes both lines, and the price and
 * discount editor — for users allowed to discount — sends the same patches.
 */
const CartItemRow = ({
    row,
    stock,
    orderId,
    onOrderUpdate,
    notify,
    canApplyDiscount,
    maxDiscountPercent,
    giftEnabled,
}) => {
    const {t} = useLanguage();
    const [editing, setEditing] = useState(false);
    const view = cartRowView(row);
    const unit = unitLabel(view.anchor.unit, t);

    const report = useCallback((result) => {
        if (result.success) onOrderUpdate(result.data);
        else notify.error(t.orderError, result.error);
    }, [onOrderUpdate, notify, t]);

    const handleQuantityChange = async (newTotal) => {
        const plan = planQuantityChange(row, newTotal);
        if (!plan) return;
        report(await orderService.updateOrderItem(orderId, plan.itemId, plan.data));
    };

    const handleGiftChange = async (targetGift) => {
        const ops = planGiftChange(row, targetGift);
        if (ops.length === 0) return;
        report(await applyGiftOps(orderId, ops));
    };

    const handleRemove = async () => {
        // Remove BOTH physical lines behind this visual row.
        const ids = [row.paid?.id, row.gift?.id].filter(Boolean);
        let last = null;
        for (const id of ids) {
            const result = await orderService.removeOrderItem(orderId, id);
            if (!result.success) {
                notify.error(t.orderError, result.error);
                return;
            }
            last = result;
        }
        if (last) onOrderUpdate(last.data);
    };

    const savePrice = async (event) => {
        const value = parseFloat(event.target.value);
        const next = Number.isFinite(value) ? value : null;
        if (next === parseFloat(view.effectivePrice)) return;
        report(await orderService.updateOrderItem(orderId, view.anchor.id, pricePatch(next)));
    };

    const saveDiscount = async (event) => {
        const value = parseFloat(event.target.value);
        const next = Number.isFinite(value) ? value : null;
        if ((next ?? 0) === view.discountPercent) return;
        report(await orderService.updateOrderItem(orderId, view.anchor.id, discountPatch(next)));
    };

    const priceText = (
        <>
            {view.hasDiscount && <s className="m-cart-item-was">{view.price} ₾</s>}
            {`${view.effectivePrice} ₾`}
            {unit && ` / ${unit}`}
            {view.discountPercent > 0 && ` · −${view.discountPercent}%`}
        </>
    );

    const over = exceedsStock(row, stock);

    return (
        <div className={`if-row m-cart-item${view.pending ? ' is-pending' : ''}`}>
            <span className="if-row-thumb" aria-hidden="true">
                <IosIcon name="package" size={26} stroke={1.8}/>
            </span>
            <div className="if-row-main">
                <div className="m-cart-item-head">
                    <span className="if-row-title if-clamp-2">{view.name}</span>
                    <span className="m-cart-item-total">{view.lineTotal} ₾</span>
                </div>
                {canApplyDiscount ? (
                    <button
                        type="button"
                        className="m-cart-item-price is-editable"
                        aria-expanded={editing}
                        aria-label={`${t.overridePrice}: ${view.effectivePrice} ₾`}
                        onClick={() => setEditing((open) => !open)}
                    >
                        {priceText}
                        <IosIcon name="chev" size={12} stroke={2.6}/>
                    </button>
                ) : (
                    <div className="m-cart-item-price">{priceText}</div>
                )}
                {canApplyDiscount && editing && (
                    <div className="m-cart-item-editor">
                        <label className="m-cart-item-field">
                            <span className="if-field-label">{t.price}</span>
                            <InputNumber
                                key={`price-${view.effectivePrice}`}
                                aria-label={t.price}
                                min={0}
                                max={view.priceCap > 0 ? view.priceCap : undefined}
                                defaultValue={parseFloat(view.effectivePrice)}
                                suffix="₾"
                                controls={false}
                                inputMode="decimal"
                                onPressEnter={(event) => event.currentTarget.blur()}
                                onBlur={savePrice}
                            />
                        </label>
                        <label className="m-cart-item-field">
                            <span className="if-field-label">{t.discountPercent}</span>
                            <InputNumber
                                key={`discount-${view.discountPercent}`}
                                aria-label={t.discountPercent}
                                min={0}
                                max={Math.min(100, maxDiscountPercent || 100)}
                                defaultValue={view.discountPercent || 0}
                                suffix="%"
                                controls={false}
                                inputMode="decimal"
                                onPressEnter={(event) => event.currentTarget.blur()}
                                onBlur={saveDiscount}
                            />
                        </label>
                    </div>
                )}
                {(Number.isFinite(stock) || view.pending) && (
                    <div className="m-cart-item-captions">
                        {Number.isFinite(stock) && (
                            over ? (
                                <span className="m-cart-item-warning">
                                    <IosIcon name="warn" size={14} stroke={2.4}/>
                                    {t.exceedsStock(stock)}
                                </span>
                            ) : (
                                <span>{t.stockRemaining}: {stock}</span>
                            )
                        )}
                        {view.pending && (
                            <span className="m-cart-item-pending">
                                <IosIcon name="cloud" size={14} stroke={2.2}/>
                                {t.offlineItemPending}
                            </span>
                        )}
                    </div>
                )}
                <div className="m-cart-item-controls">
                    <QuantityStepper
                        value={row.totalQty}
                        min={view.minQuantity}
                        onChange={handleQuantityChange}
                        label={t.quantity}
                        decrementLabel={t.decreaseQuantity}
                        incrementLabel={t.increaseQuantity}
                        iconSize={18}
                        minSlot={(
                            // At the minimum, minus becomes delete (with
                            // today's confirmation): the row cannot shrink
                            // further, and there is no room for a separate
                            // delete button beside the gift pill.
                            <Popconfirm
                                title={t.confirmDelete}
                                onConfirm={handleRemove}
                                okText={t.yes}
                                cancelText={t.no}
                            >
                                <button type="button" className="if-stepper-btn m-cart-item-delete" aria-label={t.delete}>
                                    <IosIcon name="trash" size={18}/>
                                </button>
                            </Popconfirm>
                        )}
                    />
                    <GiftCounter
                        enabled={giftEnabled}
                        totalQty={row.totalQty}
                        giftQty={row.giftQty}
                        label={t.giftLabel}
                        onChange={handleGiftChange}
                    />
                </div>
            </div>
        </div>
    );
};

export default memo(CartItemRow);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/UserDashboard/CartItemRow`
Expected: PASS — 13 tests, with no `console.error` output.

- [ ] **Step 5: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 65 suites, 447 tests.

- [ ] **Step 6: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/CartItemRow.js barcode-scanner-frontend/src/components/UserDashboard/CartItemRow.test.js
git diff --cached --name-only
git commit -m "feat(order-sheet): add the cart row with stepper, gift pill and price editor" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Delivery step

**Files:**
- Create: `barcode-scanner-frontend/src/components/UserDashboard/useDebouncedField.js`
- Create: `barcode-scanner-frontend/src/components/UserDashboard/deliveryView.js`
- Test: `barcode-scanner-frontend/src/components/UserDashboard/deliveryView.test.js`
- Create: `barcode-scanner-frontend/src/components/UserDashboard/DeliveryStep.js`
- Test: `barcode-scanner-frontend/src/components/UserDashboard/DeliveryStep.test.js`

**Interfaces:**
- Consumes: `orderService.updateOrder`; `displayCustomerName` from `../../utils/orderDisplay`; `cartItemCount`, `orderWarehouseNames` (Task 2); `IosIcon` `pin`, `person`, `calendar`, `clock`, `tab-orders`, `chev`; antd `Segmented`, `Input`/`TextArea`, `DatePicker`, `TimePicker`; keys `deliveryType`, `pickup`, `delivery`, `deliveryAddress`, `recipient`, `recipientSame`, `recipientDifferent`, `firstName`, `lastName`, `phone`, `phoneInvalid`, `deliveryDate`, `deliveryTime`, `deliveryTimeFrom`, `deliveryTimeTo`, `deliveryNotes`, `orderNotes`, `optional`, `notSet`, `orderSummary`, `client`, `warehouse`, `quantity`, `piecesCount`, `orderError`.
- Produces: default export `useDebouncedField(initialValue, onSave, delay = 600) => [value, onChange, flush]` (moved unchanged from `OrderPanel`); named exports of `deliveryView.js`: `isDeliveryOrder(order)`, `recipientPhoneValid(phone)`, `recipientPatch(value)`, `timeValue(value)`, `dateValue(value)`; default export `DeliveryStep({order, onOrderUpdate, notify})`. Classes it renders (styled in Task 6): `.m-delivery-group`, `.m-field-row`, `.m-field-label-line`, `.m-recipient-seg`, `.m-recipient-fields`, `.m-recipient-names`, `.m-field-error`, `.m-time-range`.

- [ ] **Step 1: Write the failing tests**

Create `barcode-scanner-frontend/src/components/UserDashboard/deliveryView.test.js`:

```js
import {dateValue, isDeliveryOrder, recipientPatch, recipientPhoneValid, timeValue} from './deliveryView';

describe('deliveryView', () => {
    it('treats only delivery_type "delivery" as a delivery', () => {
        expect(isDeliveryOrder({delivery_type: 'delivery'})).toBe(true);
        expect(isDeliveryOrder({delivery_type: 'pickup'})).toBe(false);
        expect(isDeliveryOrder({})).toBe(false);
    });

    it('accepts an empty phone, nine digits, or +995 and nine digits', () => {
        expect(recipientPhoneValid('')).toBe(true);
        expect(recipientPhoneValid('555 12 34 56')).toBe(true);
        expect(recipientPhoneValid('+995555123456')).toBe(true);
        expect(recipientPhoneValid('55512345')).toBe(false);
        expect(recipientPhoneValid('+1 555123456')).toBe(false);
    });

    it('clears the other recipient when switching back to the same one', () => {
        expect(recipientPatch('different')).toEqual({recipient_is_different: true});
        expect(recipientPatch('same')).toEqual({
            recipient_is_different: false,
            recipient_first_name: '',
            recipient_last_name: '',
            recipient_phone: '',
        });
    });

    it('reads stored times and dates for the pickers', () => {
        expect(timeValue('12:30:00').format('HH:mm')).toBe('12:30');
        expect(timeValue('09:05').format('HH:mm')).toBe('09:05');
        expect(timeValue(null)).toBeNull();
        expect(dateValue('2026-09-16').format('YYYY-MM-DD')).toBe('2026-09-16');
        expect(dateValue('')).toBeNull();
    });
});
```

Create `barcode-scanner-frontend/src/components/UserDashboard/DeliveryStep.test.js`:

```js
import React from 'react';
import {render, screen, fireEvent, waitFor, within} from '@testing-library/react';
import DeliveryStep from './DeliveryStep';
import {orderService} from '../../api';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';

jest.mock('../../api', () => ({
    orderService: {updateOrder: jest.fn()},
}));

const en = translations.en;

// jsdom lacks these browser APIs that antd's Segmented and pickers touch.
beforeAll(() => {
    window.matchMedia = window.matchMedia || ((query) => ({
        matches: false, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
    }));
    global.ResizeObserver = global.ResizeObserver || class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
});

const ORDER = {
    id: 42,
    customer_name: 'Giorgi Beridze',
    delivery_type: 'pickup',
    recipient_is_different: false,
    notes: '',
    items: [
        {id: 1, sku: 'PAN', warehouse_name: 'Vake', quantity: '2'},
        {id: 2, sku: 'KETTLE', warehouse_name: 'Vake', quantity: '1'},
        {id: 3, sku: 'PAN', warehouse_name: 'Central', quantity: '1', is_gift: true},
    ],
};
const UPDATED = {...ORDER, notes: 'x'};

const renderStep = (order = ORDER) => {
    const handlers = {onOrderUpdate: jest.fn(), notify: {error: jest.fn()}};
    render(
        <LanguageProvider>
            <DeliveryStep order={order} {...handlers}/>
        </LanguageProvider>
    );
    return handlers;
};

describe('DeliveryStep', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
        jest.clearAllMocks();
        orderService.updateOrder.mockResolvedValue({success: true, data: UPDATED});
    });

    afterEach(() => {
        localStorage.removeItem('language');
    });

    it('switches between pickup and delivery', async () => {
        const {onOrderUpdate} = renderStep();
        fireEvent.click(screen.getByRole('radio', {name: en.delivery}));
        await waitFor(() => expect(onOrderUpdate).toHaveBeenCalledWith(UPDATED));
        expect(orderService.updateOrder).toHaveBeenCalledWith(42, {delivery_type: 'delivery'});
    });

    it('asks for address, date, time and delivery notes only for a delivery', () => {
        renderStep();
        expect(screen.queryByRole('textbox', {name: en.deliveryAddress})).toBeNull();
        expect(screen.getByRole('textbox', {name: en.orderNotes})).toBeInTheDocument();
    });

    it('shows the delivery fields with their saved values', () => {
        renderStep({
            ...ORDER,
            delivery_type: 'delivery',
            delivery_address: 'Vazha-Pshavela Ave 45',
            delivery_date: '2026-09-16',
            delivery_time_from: '12:00:00',
            delivery_time_to: '15:00:00',
        });
        expect(screen.getByRole('textbox', {name: en.deliveryAddress})).toHaveValue('Vazha-Pshavela Ave 45');
        expect(screen.getByRole('textbox', {name: en.deliveryDate})).toHaveValue('2026-09-16');
        expect(screen.getByRole('textbox', {name: en.deliveryTimeFrom})).toHaveValue('12:00');
        expect(screen.getByRole('textbox', {name: en.deliveryTimeTo})).toHaveValue('15:00');
        expect(screen.getByRole('textbox', {name: en.deliveryNotes})).toBeInTheDocument();
    });

    it('saves the comment when the field is left', async () => {
        const {onOrderUpdate} = renderStep();
        const comment = screen.getByRole('textbox', {name: en.orderNotes});
        fireEvent.change(comment, {target: {value: 'Call first'}});
        fireEvent.blur(comment);
        await waitFor(() => expect(onOrderUpdate).toHaveBeenCalledWith(UPDATED));
        expect(orderService.updateOrder).toHaveBeenCalledWith(42, {notes: 'Call first'});
    });

    it('clears the other recipient when switching back to the same one', async () => {
        renderStep({...ORDER, recipient_is_different: true, recipient_first_name: 'Nino'});
        expect(screen.getByRole('textbox', {name: en.firstName})).toHaveValue('Nino');
        fireEvent.click(screen.getByRole('radio', {name: en.recipientSame}));
        await waitFor(() => expect(orderService.updateOrder).toHaveBeenCalledWith(42, {
            recipient_is_different: false,
            recipient_first_name: '',
            recipient_last_name: '',
            recipient_phone: '',
        }));
    });

    it('flags an invalid recipient phone in words', () => {
        renderStep({...ORDER, recipient_is_different: true, recipient_phone: '12345'});
        expect(screen.getByRole('alert')).toHaveTextContent(en.phoneInvalid);
    });

    it('summarizes the client, warehouses and quantity', () => {
        renderStep();
        const summary = screen.getByRole('heading', {name: en.orderSummary}).nextElementSibling;
        expect(within(summary).getByText('Giorgi Beridze')).toBeInTheDocument();
        expect(within(summary).getByText('Vake, Central')).toBeInTheDocument();
        expect(within(summary).getByText(en.piecesCount(4))).toBeInTheDocument();
    });

    it('reports a failed save', async () => {
        orderService.updateOrder.mockResolvedValue({success: false, error: 'nope'});
        const {notify} = renderStep();
        fireEvent.click(screen.getByRole('radio', {name: en.delivery}));
        await waitFor(() => expect(notify.error).toHaveBeenCalledWith(en.orderError, 'nope'));
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/UserDashboard/deliveryView src/components/UserDashboard/DeliveryStep`
Expected: FAIL — `Cannot find module './deliveryView'` and `Cannot find module './DeliveryStep'`.

- [ ] **Step 3: Create `useDebouncedField.js`**

Create `barcode-scanner-frontend/src/components/UserDashboard/useDebouncedField.js` (the hook from the top of `OrderPanel.js`, now exported):

```js
import {useCallback, useEffect, useRef, useState} from 'react';

/**
 * Local state for a text field that saves to the order after a pause in
 * typing (moved unchanged from OrderPanel). Returns [value, onChange, flush];
 * call flush on blur so leaving the field saves at once.
 */
const useDebouncedField = (initialValue, onSave, delay = 600) => {
    const [localValue, setLocalValue] = useState(initialValue);
    const timerRef = useRef(null);
    const latestValueRef = useRef(localValue);

    useEffect(() => {
        if (initialValue !== latestValueRef.current) {
            setLocalValue(initialValue);
            latestValueRef.current = initialValue;
        }
    }, [initialValue]);

    const handleChange = useCallback((value) => {
        setLocalValue(value);
        latestValueRef.current = value;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            onSave(value);
        }, delay);
    }, [onSave, delay]);

    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    const flush = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
            onSave(latestValueRef.current);
        }
    }, [onSave]);

    return [localValue, handleChange, flush];
};

export default useDebouncedField;
```

- [ ] **Step 4: Create `deliveryView.js`**

Create `barcode-scanner-frontend/src/components/UserDashboard/deliveryView.js`:

```js
import dayjs from 'dayjs';

// Rules of the delivery step, moved unchanged from OrderPanel's
// DeliverySection.

export const isDeliveryOrder = (order) => order?.delivery_type === 'delivery';

/** +995 and 9 digits, or 9 digits, or empty (spaces ignored). */
export const recipientPhoneValid = (phone) => (
    !phone || /^(\+995)?\d{9}$/.test(phone.replace(/\s+/g, ''))
);

/**
 * Patch for the recipient segmented control. Switching back to "same"
 * clears the other recipient's fields so the saved state matches the screen.
 */
export const recipientPatch = (value) => (
    value === 'different'
        ? {recipient_is_different: true}
        : {
            recipient_is_different: false,
            recipient_first_name: '',
            recipient_last_name: '',
            recipient_phone: '',
        }
);

/** A stored "HH:mm[:ss]" time as a dayjs value for the time picker. */
export const timeValue = (value) => {
    if (!value) return null;
    const parsed = dayjs(`2000-01-01T${value}`);
    return parsed.isValid() ? parsed : null;
};

/** A stored "YYYY-MM-DD" date as a dayjs value for the date picker. */
export const dateValue = (value) => {
    if (!value) return null;
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed : null;
};
```

- [ ] **Step 5: Create `DeliveryStep.js`**

Create `barcode-scanner-frontend/src/components/UserDashboard/DeliveryStep.js`:

```js
import React, {useCallback, useId} from 'react';
import dayjs from 'dayjs';
import {DatePicker, Input, Segmented, TimePicker} from 'antd';
import {orderService} from '../../api';
import {useLanguage} from '../../i18n/LanguageContext';
import displayCustomerName from '../../utils/orderDisplay';
import IosIcon from '../Common/IosIcon';
import useDebouncedField from './useDebouncedField';
import {cartItemCount, orderWarehouseNames} from './cartSheetView';
import {
    dateValue,
    isDeliveryOrder,
    recipientPatch,
    recipientPhoneValid,
    timeValue,
} from './deliveryView';

const {TextArea} = Input;

/**
 * Step 2 of the order sheet: pickup or delivery, the recipient, the delivery
 * address, date and time window and notes, the order comment, and a summary.
 * Every field saves to the order as OrderPanel's delivery and notes sections
 * did — the same fields, debounce, and phone rule.
 */
const DeliveryStep = ({order, onOrderUpdate, notify}) => {
    const {t} = useLanguage();
    const recipientLabelId = useId();

    const save = useCallback(async (patch) => {
        const result = await orderService.updateOrder(order.id, patch);
        if (result.success) onOrderUpdate(result.data);
        else notify.error(t.orderError, result.error);
    }, [order.id, onOrderUpdate, notify, t]);

    const [address, setAddress, flushAddress] = useDebouncedField(
        order.delivery_address || '',
        useCallback((value) => save({delivery_address: value || ''}), [save]),
    );
    const [deliveryNotes, setDeliveryNotes, flushDeliveryNotes] = useDebouncedField(
        order.delivery_notes || '',
        useCallback((value) => save({delivery_notes: value || ''}), [save]),
    );
    const [notes, setNotes, flushNotes] = useDebouncedField(
        order.notes || '',
        useCallback((value) => save({notes: value || ''}), [save]),
    );
    const [recipientFirst, setRecipientFirst, flushRecipientFirst] = useDebouncedField(
        order.recipient_first_name || '',
        useCallback((value) => save({recipient_first_name: value || ''}), [save]),
    );
    const [recipientLast, setRecipientLast, flushRecipientLast] = useDebouncedField(
        order.recipient_last_name || '',
        useCallback((value) => save({recipient_last_name: value || ''}), [save]),
    );
    const [recipientPhone, setRecipientPhone, flushRecipientPhone] = useDebouncedField(
        order.recipient_phone || '',
        useCallback((value) => save({recipient_phone: value || ''}), [save]),
    );

    const delivery = isDeliveryOrder(order);
    const recipientIsDifferent = !!order.recipient_is_different;
    const phoneValid = recipientPhoneValid(recipientPhone);

    return (
        <>
            <Segmented
                className="if-seg"
                block
                aria-label={t.deliveryType}
                value={order.delivery_type || 'pickup'}
                onChange={(value) => save({delivery_type: value})}
                options={[
                    {label: t.pickup, value: 'pickup'},
                    {label: t.delivery, value: 'delivery'},
                ]}
            />

            <div className="if-group is-lead-inset m-delivery-group">
                {delivery && (
                    <div className="if-row m-field-row">
                        <span className="if-row-icon"><IosIcon name="pin" size={22}/></span>
                        <div className="if-row-main">
                            <span className="if-field-label">{t.deliveryAddress}</span>
                            <TextArea
                                variant="borderless"
                                className="if-field-input"
                                aria-label={t.deliveryAddress}
                                placeholder={t.notSet}
                                autoSize={{minRows: 1, maxRows: 3}}
                                value={address}
                                onChange={(event) => setAddress(event.target.value)}
                                onBlur={flushAddress}
                            />
                        </div>
                    </div>
                )}

                <div className="if-row">
                    <span className="if-row-icon"><IosIcon name="person" size={22}/></span>
                    <span className="if-row-label" id={recipientLabelId}>{t.recipient}</span>
                    <Segmented
                        className="if-seg is-inset m-recipient-seg"
                        aria-labelledby={recipientLabelId}
                        value={recipientIsDifferent ? 'different' : 'same'}
                        onChange={(value) => save(recipientPatch(value))}
                        options={[
                            {label: t.recipientSame, value: 'same'},
                            {label: t.recipientDifferent, value: 'different'},
                        ]}
                    />
                </div>

                {recipientIsDifferent && (
                    <div className="if-row m-field-row m-recipient-fields">
                        <div className="if-row-main">
                            <div className="m-recipient-names">
                                <Input
                                    aria-label={t.firstName}
                                    placeholder={t.firstName}
                                    value={recipientFirst}
                                    onChange={(event) => setRecipientFirst(event.target.value)}
                                    onBlur={flushRecipientFirst}
                                    size="large"
                                />
                                <Input
                                    aria-label={t.lastName}
                                    placeholder={t.lastName}
                                    value={recipientLast}
                                    onChange={(event) => setRecipientLast(event.target.value)}
                                    onBlur={flushRecipientLast}
                                    size="large"
                                />
                            </div>
                            <Input
                                aria-label={t.phone}
                                placeholder={t.phone}
                                value={recipientPhone}
                                onChange={(event) => setRecipientPhone(event.target.value)}
                                onBlur={flushRecipientPhone}
                                size="large"
                                status={phoneValid ? '' : 'error'}
                                inputMode="tel"
                            />
                            {!phoneValid && <div className="m-field-error" role="alert">{t.phoneInvalid}</div>}
                        </div>
                    </div>
                )}

                {delivery && (
                    <>
                        <div className="if-row m-field-row">
                            <span className="if-row-icon"><IosIcon name="calendar" size={22}/></span>
                            <div className="if-row-main">
                                <span className="if-field-label">{t.deliveryDate}</span>
                                <DatePicker
                                    variant="borderless"
                                    className="if-field-input"
                                    aria-label={t.deliveryDate}
                                    placeholder={t.notSet}
                                    value={dateValue(order.delivery_date)}
                                    // DRF DateField rejects empty strings; send null when cleared.
                                    onChange={(date, dateString) => save({delivery_date: dateString || null})}
                                    disabledDate={(current) => current && current < dayjs().startOf('day')}
                                    suffixIcon={<IosIcon name="chev" size={16} stroke={2.4}/>}
                                />
                            </div>
                        </div>
                        <div className="if-row m-field-row">
                            <span className="if-row-icon"><IosIcon name="clock" size={22}/></span>
                            <div className="if-row-main">
                                <span className="if-field-label">{t.deliveryTime}</span>
                                <div className="m-time-range">
                                    <TimePicker
                                        variant="borderless"
                                        className="if-field-input"
                                        aria-label={t.deliveryTimeFrom}
                                        placeholder={t.deliveryTimeFrom}
                                        format="HH:mm"
                                        needConfirm={false}
                                        suffixIcon={null}
                                        value={timeValue(order.delivery_time_from)}
                                        onChange={(time, timeString) => save({delivery_time_from: timeString || null})}
                                    />
                                    <span aria-hidden="true">–</span>
                                    <TimePicker
                                        variant="borderless"
                                        className="if-field-input"
                                        aria-label={t.deliveryTimeTo}
                                        placeholder={t.deliveryTimeTo}
                                        format="HH:mm"
                                        needConfirm={false}
                                        suffixIcon={null}
                                        value={timeValue(order.delivery_time_to)}
                                        onChange={(time, timeString) => save({delivery_time_to: timeString || null})}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="if-row m-field-row">
                            <span className="if-row-icon"><IosIcon name="tab-orders" size={22}/></span>
                            <div className="if-row-main">
                                <span className="if-field-label">{t.deliveryNotes}</span>
                                <TextArea
                                    variant="borderless"
                                    className="if-field-input"
                                    aria-label={t.deliveryNotes}
                                    placeholder={t.notSet}
                                    autoSize={{minRows: 1, maxRows: 4}}
                                    value={deliveryNotes}
                                    onChange={(event) => setDeliveryNotes(event.target.value)}
                                    onBlur={flushDeliveryNotes}
                                />
                            </div>
                        </div>
                    </>
                )}

                <div className="if-row m-field-row">
                    <span className="if-row-icon"><IosIcon name="tab-orders" size={22}/></span>
                    <div className="if-row-main">
                        <span className="m-field-label-line">
                            <span className="if-field-label">{t.orderNotes}</span>
                            <span className="if-field-hint">{t.optional}</span>
                        </span>
                        <TextArea
                            variant="borderless"
                            className="if-field-input"
                            aria-label={t.orderNotes}
                            placeholder={t.notSet}
                            autoSize={{minRows: 1, maxRows: 4}}
                            value={notes}
                            onChange={(event) => setNotes(event.target.value)}
                            onBlur={flushNotes}
                        />
                    </div>
                </div>
            </div>

            <h4 className="if-section-header">{t.orderSummary}</h4>
            <div className="if-group">
                <div className="if-row">
                    <span className="if-row-label">{t.client}</span>
                    <span className="if-row-value">{displayCustomerName(order, t) || '—'}</span>
                </div>
                <div className="if-row">
                    <span className="if-row-label">{t.warehouse}</span>
                    <span className="if-row-value">{orderWarehouseNames(order.items).join(', ') || '—'}</span>
                </div>
                <div className="if-row">
                    <span className="if-row-label">{t.quantity}</span>
                    <span className="if-row-value">{t.piecesCount(cartItemCount(order.items))}</span>
                </div>
            </div>
        </>
    );
};

export default DeliveryStep;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/UserDashboard/deliveryView src/components/UserDashboard/DeliveryStep`
Expected: PASS — 4 + 8 = 12 tests (the `NaN` height warning from `TextArea autoSize` is expected; nothing else in `console.error`).

- [ ] **Step 7: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 67 suites, 459 tests.

- [ ] **Step 8: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/useDebouncedField.js barcode-scanner-frontend/src/components/UserDashboard/deliveryView.js barcode-scanner-frontend/src/components/UserDashboard/deliveryView.test.js barcode-scanner-frontend/src/components/UserDashboard/DeliveryStep.js barcode-scanner-frontend/src/components/UserDashboard/DeliveryStep.test.js
git diff --cached --name-only
git commit -m "feat(order-sheet): add the delivery step with inline fields and an order summary" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Order sheet

**Files:**
- Create: `barcode-scanner-frontend/src/components/UserDashboard/useSkuStock.js`
- Create: `barcode-scanner-frontend/src/components/UserDashboard/OrderSheet.js`
- Test: `barcode-scanner-frontend/src/components/UserDashboard/OrderSheet.test.js`
- Modify: `barcode-scanner-frontend/src/index.css`

**Interfaces:**
- Consumes: `IosSheet` (3a), `CartItemRow` (Task 4), `DeliveryStep` (Task 5), `OfflineBanner` (unchanged), `cartSheetView` (Task 2), `AuthContext` (read only: `authData.user.can_apply_discount`, `authData.user.max_discount_percent`, `authData.gift_marking_enabled`), `productService.searchProduct`, antd `Dropdown`, `Modal.useModal`, `Popconfirm`; keys `cart`, `stepProducts`, `stepDelivery`, `moreActions`, `saveForLater`, `changeCustomer`, `deleteOrder`, `confirmDeleteOrder`, `yes`, `no`, `cartTotalCount`, `giftLabel`, `nextStep`, `total`, `confirmProceedToPayment`, `confirmOrder`, `productsInWarehouse`, `scanToAddProduct`, `close`, `back`.
- Produces: default export `useSkuStock(items, active) => {[sku]: {[warehouseCode]: freeQuantity}}` (one `searchProduct({sku: article || sku, searchType: 'article', warehouseCodes: [], includeImages: false})` per SKU while `active`; negative balances dropped; forgotten when inactive).
- Produces: default export `OrderSheet({open, order, onClose, onOrderUpdate, onSaveForLater, onProceedToPayment, onDeleteOrder, onChangeCustomer, notify, confirmDisabled})`. Step 1: dialog named `t.cart`, subtitle `1 / 2 · <stepProducts>`, ⋯ menu, client row (button → `onChangeCustomer`), one `<section aria-label=warehouse>` per warehouse, bar with `cartTotalCount(units)` (+ ` · N <giftLabel>`), total and "შემდეგი" (disabled without items). Step 2: dialog named `t.stepDelivery`, subtitle `2 / 2`, back button, `DeliveryStep`, bar with `t.total`, total and `t.confirmOrder` behind a Popconfirm (`t.confirmProceedToPayment`), disabled without items or when `confirmDisabled`.
- Produces (index.css): the "Order sheet" block for every class listed in Tasks 4 and 5 plus `.m-client-avatar` and `.m-cart-empty`.

- [ ] **Step 1: Write the failing test**

Create `barcode-scanner-frontend/src/components/UserDashboard/OrderSheet.test.js`:

```js
import React from 'react';
import {render, screen, fireEvent, waitFor, within} from '@testing-library/react';
import OrderSheet from './OrderSheet';
import AuthContext from '../Auth/AuthContext';
import {productService} from '../../api';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';

jest.mock('../../api', () => ({
    orderService: {
        updateOrder: jest.fn(),
        updateOrderItem: jest.fn(),
        removeOrderItem: jest.fn(),
        addOrderItem: jest.fn(),
    },
    productService: {searchProduct: jest.fn()},
}));

const en = translations.en;

// jsdom lacks these browser APIs that antd's Drawer, Dropdown and Modal touch.
beforeAll(() => {
    window.matchMedia = window.matchMedia || ((query) => ({
        matches: false, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
    }));
    global.ResizeObserver = global.ResizeObserver || class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
});

const item = (overrides) => ({
    id: 1,
    sku: 'PAN',
    sku_name: 'Granite pan',
    article: 'MG-2814',
    warehouse_code: 'W1',
    warehouse_name: 'Vake',
    quantity: '2',
    price: '89.90',
    effective_price: '89.90',
    discount_percent: '0.00',
    line_total: '179.80',
    is_gift: false,
    unit: 'piece',
    ...overrides,
});

const ORDER = {
    id: 42,
    customer_name: 'Giorgi Beridze',
    customer_identification_number: '01024012345',
    customer_phone: '555123456',
    delivery_type: 'pickup',
    total: '299.30',
    items: [
        item(),
        item({id: 2, sku: 'KETTLE', sku_name: 'Kettle', article: 'EK-1700', quantity: '1', price: '119.50', effective_price: '119.50', line_total: '119.50'}),
        item({id: 3, quantity: '1', is_gift: true, line_total: '0.00'}),
    ],
};

const AUTH = {authData: {user: {can_apply_discount: false, max_discount_percent: '0'}, gift_marking_enabled: true}};

const renderSheet = (props = {}) => {
    const handlers = {
        onClose: jest.fn(),
        onOrderUpdate: jest.fn(),
        onSaveForLater: jest.fn(),
        onProceedToPayment: jest.fn(),
        onDeleteOrder: jest.fn(),
        onChangeCustomer: jest.fn(),
        notify: {error: jest.fn()},
    };
    render(
        <AuthContext.Provider value={AUTH}>
            <LanguageProvider>
                <OrderSheet open order={ORDER} confirmDisabled={false} {...handlers} {...props}/>
            </LanguageProvider>
        </AuthContext.Provider>
    );
    return handlers;
};

describe('OrderSheet', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
        jest.clearAllMocks();
        // Stock lookups stay pending unless a test answers them, so no state
        // update lands after a test has finished.
        productService.searchProduct.mockImplementation(() => new Promise(() => {}));
    });

    afterEach(() => {
        localStorage.removeItem('language');
    });

    it('opens on the cart step with the client and products by warehouse', async () => {
        productService.searchProduct.mockResolvedValue({
            success: true,
            data: {stock: [{warehouse: 'W1', quantity: '9'}]},
        });
        renderSheet();
        const sheet = screen.getByRole('dialog', {name: en.cart});
        expect(sheet).toHaveTextContent(`1 / 2 · ${en.stepProducts}`);
        expect(within(sheet).getByRole('button', {name: /Giorgi Beridze/})).toHaveTextContent('01024012345 · 555123456');
        const vake = within(sheet).getByRole('region', {name: 'Vake'});
        expect(vake).toHaveTextContent(en.productsInWarehouse(2));
        expect(within(vake).getByText('Granite pan')).toBeInTheDocument();
        expect(within(vake).getByText('Kettle')).toBeInTheDocument();
        await waitFor(() => expect(within(vake).getAllByText(`${en.stockRemaining}: 9`)).toHaveLength(2));
        expect(productService.searchProduct).toHaveBeenCalledTimes(2);
        expect(productService.searchProduct).toHaveBeenCalledWith({
            sku: 'MG-2814', searchType: 'article', warehouseCodes: [], includeImages: false,
        });
    });

    it('totals units and gifts in the bar', () => {
        renderSheet();
        expect(screen.getByText(`${en.cartTotalCount(4)} · 1 ${en.giftLabel}`)).toBeInTheDocument();
        expect(screen.getByText('299.30 ₾')).toBeInTheDocument();
    });

    it('changes the customer from the client row', () => {
        const {onChangeCustomer} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: /Giorgi Beridze/}));
        expect(onChangeCustomer).toHaveBeenCalledTimes(1);
    });

    it('cannot go on without products', () => {
        renderSheet({order: {...ORDER, items: [], total: '0.00'}});
        expect(screen.getByRole('button', {name: en.nextStep})).toBeDisabled();
        expect(screen.getByText(en.scanToAddProduct)).toBeInTheDocument();
    });

    it('goes to delivery and back', () => {
        renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.nextStep}));
        const delivery = screen.getByRole('dialog', {name: en.stepDelivery});
        expect(delivery).toHaveTextContent('2 / 2');
        expect(screen.queryByRole('button', {name: en.moreActions})).toBeNull();
        expect(within(delivery).getByRole('heading', {name: en.orderSummary})).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: en.back}));
        expect(screen.getByRole('dialog', {name: en.cart})).toBeInTheDocument();
    });

    it('confirms the order from the delivery step after asking', async () => {
        const {onProceedToPayment} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.nextStep}));
        expect(screen.getByText(en.total)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: en.confirmOrder}));
        expect(await screen.findByText(en.confirmProceedToPayment)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: en.yes}));
        await waitFor(() => expect(onProceedToPayment).toHaveBeenCalledTimes(1));
    });

    it('cannot confirm while offline or with unsynced changes', () => {
        renderSheet({confirmDisabled: true});
        fireEvent.click(screen.getByRole('button', {name: en.nextStep}));
        expect(screen.getByRole('button', {name: en.confirmOrder})).toBeDisabled();
    });

    it('saves the order for later from the ⋯ menu', async () => {
        const {onSaveForLater} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.moreActions}));
        fireEvent.click(await screen.findByRole('menuitem', {name: new RegExp(en.saveForLater)}));
        expect(onSaveForLater).toHaveBeenCalledTimes(1);
    });

    it('changes the customer from the ⋯ menu', async () => {
        const {onChangeCustomer} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.moreActions}));
        fireEvent.click(await screen.findByRole('menuitem', {name: new RegExp(en.changeCustomer)}));
        expect(onChangeCustomer).toHaveBeenCalledTimes(1);
    });

    it('deletes the order from the ⋯ menu only after confirming', async () => {
        const {onDeleteOrder} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.moreActions}));
        fireEvent.click(await screen.findByRole('menuitem', {name: new RegExp(en.deleteOrder)}));
        const confirm = await screen.findByRole('dialog', {name: en.confirmDeleteOrder});
        expect(onDeleteOrder).not.toHaveBeenCalled();
        fireEvent.click(within(confirm).getByRole('button', {name: en.yes}));
        await waitFor(() => expect(onDeleteOrder).toHaveBeenCalledTimes(1));
    });

    it('closes from the close button', () => {
        const {onClose} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.close}));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/UserDashboard/OrderSheet`
Expected: FAIL — `Cannot find module './OrderSheet'`.

- [ ] **Step 3: Create `useSkuStock.js`**

Create `barcode-scanner-frontend/src/components/UserDashboard/useSkuStock.js`:

```js
import {useEffect, useRef, useState} from 'react';
import {productService} from '../../api';
import groupItemsBySku from './groupItemsBySku';

/**
 * Live free stock per product for the cart's stock captions and warnings:
 * one lookup per SKU while the sheet is open, as each product card used to
 * make on mount. Returns {[sku]: {[warehouseCode]: quantity}}; a failed
 * lookup leaves its SKU out, so its rows show no caption. Closing the sheet
 * forgets everything, so the next opening asks again.
 */
const useSkuStock = (items, active) => {
    const [stockBySku, setStockBySku] = useState({});
    const requestedRef = useRef(new Set());
    const generationRef = useRef(0);

    useEffect(() => {
        if (!active) {
            if (requestedRef.current.size > 0) {
                generationRef.current += 1;
                requestedRef.current = new Set();
                setStockBySku({});
            }
            return;
        }
        const generation = generationRef.current;
        groupItemsBySku(items || []).forEach((group) => {
            if (requestedRef.current.has(group.sku)) return;
            requestedRef.current.add(group.sku);
            // GetStockAndPrices keys off the article (or a barcode); the
            // canonical sku is not always a valid lookup key.
            const lookupKey = group.article || group.sku;
            productService.searchProduct({
                sku: lookupKey,
                searchType: 'article',
                warehouseCodes: [],
                includeImages: false,
            }).then((result) => {
                if (generation !== generationRef.current) return;
                if (result.success && Array.isArray(result.data?.stock)) {
                    const byWarehouse = {};
                    // Hide negative balances, as the product lookup does.
                    result.data.stock
                        .filter((entry) => (Number(entry.quantity) || 0) >= 0)
                        .forEach((entry) => {
                            byWarehouse[entry.warehouse] = Number(entry.quantity || 0);
                        });
                    setStockBySku((prev) => ({...prev, [group.sku]: byWarehouse}));
                } else {
                    // eslint-disable-next-line no-console
                    console.warn('[cart] stock fetch failed for', lookupKey, result);
                }
            });
        });
    }, [items, active]);

    return stockBySku;
};

export default useSkuStock;
```

- [ ] **Step 4: Create `OrderSheet.js`**

Create `barcode-scanner-frontend/src/components/UserDashboard/OrderSheet.js`:

```js
import React, {useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {Dropdown, Modal, Popconfirm} from 'antd';
import {DeleteOutlined, SaveOutlined, UserSwitchOutlined} from '@ant-design/icons';
import AuthContext from '../Auth/AuthContext';
import {useLanguage} from '../../i18n/LanguageContext';
import displayCustomerName from '../../utils/orderDisplay';
import IosIcon from '../Common/IosIcon';
import IosSheet from '../Common/IosSheet';
import CartItemRow from './CartItemRow';
import DeliveryStep from './DeliveryStep';
import OfflineBanner from './OfflineBanner';
import useSkuStock from './useSkuStock';
import {
    cartGiftCount,
    cartItemCount,
    cartSections,
    customerInitials,
    hasOrderItems,
    orderStepHeader,
} from './cartSheetView';

const customerKey = (order) => `${order?.external_client_id || ''}|${order?.customer_name || ''}`;

/**
 * The active order as a two-step sheet: the cart (step 1: client, products
 * by warehouse, Next) and delivery (step 2: delivery details, summary,
 * Confirm). Save for later, change customer and delete order live in the
 * cart's ⋯ menu.
 *
 * Like OrderPanel before it, the sheet keeps the order in LOCAL state and
 * reports edits to the dashboard through onOrderUpdate (which only updates a
 * ref), so an edit does not re-render the dashboard. Every opening starts
 * again from the dashboard's order on step 1.
 */
const OrderSheet = ({
    open,
    order,
    onClose,
    onOrderUpdate,
    onSaveForLater,
    onProceedToPayment,
    onDeleteOrder,
    onChangeCustomer,
    notify,
    confirmDisabled,
}) => {
    const {t} = useLanguage();
    const {authData} = useContext(AuthContext);
    // Rendered through a context holder so the confirm follows the app theme.
    const [modal, modalContextHolder] = Modal.useModal();
    const discountConfig = useMemo(() => ({
        canApplyDiscount: !!authData?.user?.can_apply_discount,
        maxDiscountPercent: parseFloat(authData?.user?.max_discount_percent || 0),
        giftEnabled: !!authData?.gift_marking_enabled,
    }), [authData?.user?.can_apply_discount, authData?.user?.max_discount_percent,
         authData?.gift_marking_enabled]);

    const [localOrder, setLocalOrder] = useState(order);
    const [step, setStep] = useState(1);

    const onOrderUpdateRef = useRef(onOrderUpdate);
    onOrderUpdateRef.current = onOrderUpdate;

    // Sync from OUTSIDE (OrderPanel's rules): another order, items added from
    // the product sheet, or the customer changed from the ⋯ menu.
    const lastOrderIdRef = useRef(order?.id);
    const lastItemCountRef = useRef(order?.items?.length || 0);
    const lastCustomerKeyRef = useRef(customerKey(order));

    useEffect(() => {
        if (order?.id !== lastOrderIdRef.current) {
            setLocalOrder(order);
            lastOrderIdRef.current = order?.id;
            lastItemCountRef.current = order?.items?.length || 0;
            lastCustomerKeyRef.current = customerKey(order);
            setStep(1);
            return;
        }
        const itemCount = order?.items?.length || 0;
        if (itemCount !== lastItemCountRef.current) {
            setLocalOrder(order);
            lastItemCountRef.current = itemCount;
        }
        if (customerKey(order) !== lastCustomerKeyRef.current) {
            setLocalOrder(order);
            lastCustomerKeyRef.current = customerKey(order);
        }
    }, [order]);

    // Each opening starts from the dashboard's order, on step 1.
    useEffect(() => {
        if (open) {
            setLocalOrder(order);
            lastOrderIdRef.current = order?.id;
            lastItemCountRef.current = order?.items?.length || 0;
            lastCustomerKeyRef.current = customerKey(order);
            setStep(1);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const handleLocalOrderUpdate = useCallback((updatedOrder) => {
        setLocalOrder(updatedOrder);
        lastItemCountRef.current = updatedOrder?.items?.length || 0;
        if (onOrderUpdateRef.current) onOrderUpdateRef.current(updatedOrder);
    }, []);

    const items = localOrder?.items;
    const sections = useMemo(() => cartSections(items), [items]);
    const stockBySku = useSkuStock(items, open);

    if (!localOrder) return null;

    const hasItems = hasOrderItems(localOrder);
    const header = orderStepHeader(step, t);
    const giftCount = cartGiftCount(items);

    const handleDeleteClick = () => {
        modal.confirm({
            title: t.confirmDeleteOrder,
            okText: t.yes,
            cancelText: t.no,
            okButtonProps: {danger: true},
            onOk: onDeleteOrder,
        });
    };

    const menu = {
        items: [
            {key: 'save', label: t.saveForLater, icon: <SaveOutlined/>, onClick: onSaveForLater},
            {key: 'change-customer', label: t.changeCustomer, icon: <UserSwitchOutlined/>, onClick: onChangeCustomer},
            {type: 'divider'},
            {key: 'delete', label: t.deleteOrder, icon: <DeleteOutlined/>, danger: true, onClick: handleDeleteClick},
        ],
    };

    const trailing = step === 1 ? (
        <Dropdown menu={menu} trigger={['click']} placement="bottomRight">
            <button type="button" className="if-glass-btn" aria-label={t.moreActions}>
                <IosIcon name="more" size={20}/>
            </button>
        </Dropdown>
    ) : null;

    const total = (
        <span className="if-title-2 if-sheet-total-value">{localOrder.total} ₾</span>
    );

    const bottomBar = step === 1 ? (
        <>
            <div className="if-sheet-total">
                <span className="if-sheet-total-label">
                    {t.cartTotalCount(cartItemCount(items))}
                    {giftCount > 0 && ` · ${giftCount} ${t.giftLabel}`}
                </span>
                {total}
            </div>
            <button
                type="button"
                className="if-btn if-btn-primary"
                disabled={!hasItems}
                onClick={() => setStep(2)}
            >
                {t.nextStep}
            </button>
        </>
    ) : (
        <>
            <div className="if-sheet-total">
                <span className="if-sheet-total-label">{t.total}</span>
                {total}
            </div>
            <Popconfirm
                title={t.confirmProceedToPayment}
                onConfirm={onProceedToPayment}
                okText={t.yes}
                cancelText={t.no}
                disabled={!hasItems || confirmDisabled}
            >
                <button
                    type="button"
                    className="if-btn if-btn-primary"
                    disabled={!hasItems || confirmDisabled}
                >
                    {t.confirmOrder}
                </button>
            </Popconfirm>
        </>
    );

    const isRetail = !!localOrder.is_retail;
    const clientName = displayCustomerName(localOrder, t);
    const clientDetails = [localOrder.customer_identification_number, localOrder.customer_phone]
        .filter(Boolean).join(' · ');

    return (
        <>
        {modalContextHolder}
        <IosSheet
            open={open}
            onClose={onClose}
            title={header.title}
            subtitle={header.subtitle}
            leading={header.leading}
            onBack={() => setStep(1)}
            trailing={trailing}
            bottomBar={bottomBar}
        >
            <OfflineBanner orderId={localOrder.id}/>
            {step === 1 ? (
                <>
                    <div className="if-group m-cart-client">
                        <button type="button" className="if-row" onClick={onChangeCustomer}>
                            <span className="m-client-avatar" aria-hidden="true">
                                {isRetail || !customerInitials(clientName)
                                    ? <IosIcon name="person" size={22}/>
                                    : customerInitials(clientName)}
                            </span>
                            <span className="if-row-main">
                                <span className="if-row-title">{clientName || `#${localOrder.id}`}</span>
                                {clientDetails && <span className="if-row-subtitle">{clientDetails}</span>}
                            </span>
                            <span className="if-chev"><IosIcon name="chev" size={16} stroke={2.4}/></span>
                        </button>
                    </div>
                    {sections.length === 0 ? (
                        <div className="if-group if-group-empty m-cart-empty">{t.scanToAddProduct}</div>
                    ) : sections.map((section) => (
                        <section key={section.key} aria-label={section.warehouseName}>
                            <h4 className="if-section-header is-split">
                                <span>{section.warehouseName}</span>
                                <span>{t.productsInWarehouse(section.rows.length)}</span>
                            </h4>
                            <div className="if-group is-thumb-inset">
                                {section.rows.map((row) => (
                                    <CartItemRow
                                        key={row.key}
                                        row={row}
                                        stock={stockBySku[row.sku]?.[row.warehouse_code]}
                                        orderId={localOrder.id}
                                        onOrderUpdate={handleLocalOrderUpdate}
                                        notify={notify}
                                        canApplyDiscount={discountConfig.canApplyDiscount}
                                        maxDiscountPercent={discountConfig.maxDiscountPercent}
                                        giftEnabled={discountConfig.giftEnabled}
                                    />
                                ))}
                            </div>
                        </section>
                    ))}
                </>
            ) : (
                <DeliveryStep order={localOrder} onOrderUpdate={handleLocalOrderUpdate} notify={notify}/>
            )}
        </IosSheet>
        </>
    );
};

export default OrderSheet;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/UserDashboard/OrderSheet`
Expected: PASS — 11 tests. The `NaN` height warning is expected; a "not wrapped in act(...)" warning is not (stock lookups must stay pending in the tests that do not answer them — see the `beforeEach`).

- [ ] **Step 6: Order sheet styles**

In `barcode-scanner-frontend/src/index.css`, replace (the end of phase 3a's product sheet block):

```css
.m-others-chev.is-open {
  transform: rotate(-90deg);
}
```

with:

```css
.m-others-chev.is-open {
  transform: rotate(-90deg);
}

/* ===== Order sheet (OrderSheet.js, CartItemRow.js, DeliveryStep.js) =====
   theme/ios.css loads after this file, so rules that adjust an .if-*
   primitive carry both classes. */
.m-client-avatar {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--if-fill);
  color: var(--if-label-2);
  font-size: 15px;
  line-height: 20px;
  font-weight: 600;
}

.if-group.m-cart-empty {
  margin-top: 16px;
}

.if-row.m-cart-item {
  align-items: flex-start;
  padding-top: 12px;
  padding-bottom: 12px;
}

.if-row.m-cart-item.is-pending {
  opacity: 0.6;
}

.m-cart-item-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.m-cart-item-head .if-row-title {
  flex: 1;
  min-width: 0;
}

.m-cart-item-total {
  flex: none;
  font-size: 15px;
  line-height: 20px;
  font-weight: 600;
  color: var(--if-label);
  font-variant-numeric: tabular-nums;
}

.m-cart-item-price {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  font-family: inherit;
  font-size: 13px;
  line-height: 18px;
  color: var(--if-label-2);
  text-align: left;
  font-variant-numeric: tabular-nums;
}

/* Editable for users who may discount: link colour, and a 44 px target that
   overlaps its neighbours instead of spreading the row. */
.m-cart-item-price.is-editable {
  min-height: 44px;
  margin: -13px 0;
  color: var(--if-tint-text);
  cursor: pointer;
}

.m-cart-item-was {
  margin-right: 4px;
  color: var(--if-label-3);
}

.m-cart-item-editor {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 8px;
}

.m-cart-item-field .ant-input-number {
  width: 100%;
  margin-top: 2px;
}

.m-cart-item-captions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 2px;
  font-size: 13px;
  line-height: 18px;
  color: var(--if-label-2);
  font-variant-numeric: tabular-nums;
}

.m-cart-item-warning,
.m-cart-item-pending {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--if-orange-text);
}

.m-cart-item-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin-top: 8px;
}

.m-cart-item-controls .if-stepper-btn.m-cart-item-delete {
  color: var(--if-red-text);
}

.m-gift {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.m-gift-count {
  min-width: 44px;
  font-size: 13px;
  line-height: 18px;
  font-weight: 600;
  text-align: center;
  color: var(--if-label);
  font-variant-numeric: tabular-nums;
}

.if-group.m-delivery-group {
  margin-top: 16px;
}

.if-row.m-field-row {
  align-items: flex-start;
}

.m-field-row .if-row-icon {
  margin-top: 9px;
}

.m-field-label-line {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.if-seg.ant-segmented.m-recipient-seg {
  flex: none;
  width: 132px;
}

.if-row.m-recipient-fields {
  padding-left: 52px;
}

.m-recipient-names {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 8px;
}

.m-field-error {
  margin-top: 4px;
  font-size: 13px;
  line-height: 18px;
  color: var(--if-red-text);
}

.m-time-range {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--if-label-2);
}

.m-time-range .if-field-input.ant-picker {
  flex: 1;
  min-width: 0;
}
```

- [ ] **Step 7: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 68 suites, 470 tests.

- [ ] **Step 8: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/useSkuStock.js barcode-scanner-frontend/src/components/UserDashboard/OrderSheet.js barcode-scanner-frontend/src/components/UserDashboard/OrderSheet.test.js barcode-scanner-frontend/src/index.css
git diff --cached --name-only
git commit -m "feat(order-sheet): add the two-step order sheet with the order menu" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Open the active order in the order sheet

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js`

**Interfaces:**
- Consumes: `OrderSheet` (Task 6); existing `orderDrawerVisible`, `showOrderPanel`, `activeOrder`, `closeOrderDrawer`, `handleOrderUpdate`, `handleSaveForLater`, `handleProceedToPayment`, `handleDeleteActiveOrder`, `setChangeCustomerOpen`, `notify`, `activeOrderOffline`, `activeOrderPending`.
- Produces: the active-order bar and `handleContinueOrder` open `OrderSheet`; the antd order `Drawer`, its title and the dashboard's own swipe handlers are gone (IosSheet swipes). `OrderPanel` is no longer imported (deleted in Task 8).

No new tests: this task swaps the tested `OrderSheet` in for the drawer. The suite must stay green and Step 6's checks must pass.

- [ ] **Step 1: Imports**

In `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js`, replace:

```js
import OrderPanel from './OrderPanel';
```

with:

```js
import OrderSheet from './OrderSheet';
```

replace:

```js
import {
    Badge,
    Button,
    Collapse,
    Drawer,
    Empty,
```

with:

```js
import {
    Button,
    Collapse,
    Empty,
```

and replace:

```js
    ShoppingOutlined,
    ShoppingCartOutlined,
    InboxOutlined,
```

with:

```js
    ShoppingOutlined,
    InboxOutlined,
```

- [ ] **Step 2: State and comments**

Replace:

```js
    // Order drawer for mobile (shows active order)
    const [orderDrawerVisible, setOrderDrawerVisible] = useState(false);
    const orderDrawerSwipeRef = useRef({startY: 0, fired: false});
```

with:

```js
    // Order sheet (the active order's cart and delivery steps)
    const [orderDrawerVisible, setOrderDrawerVisible] = useState(false);
```

and replace:

```js
    // Called by OrderPanel when order details change (quantity, discount, delivery, etc.)
    // Only update the ref — do NOT call setActiveOrder here, as that would re-render
    // the parent and cause the Drawer to re-animate (slide down and back up).
    // The OrderPanel manages its own local state for display.
```

with:

```js
    // Called by OrderSheet when order details change (quantity, discount, delivery, etc.)
    // Only update the ref — do NOT call setActiveOrder here, as that would re-render
    // the dashboard on every edit. The sheet keeps its own local copy for
    // display; closeOrderDrawer copies the ref back into state.
```

- [ ] **Step 3: Remove the drawer's swipe handlers**

Replace:

```js
    // Swipe-down-to-dismiss for the order drawer. Triggers only when the
    // content is already scrolled to the top, so vertical scrolling within
    // the drawer is unaffected.
    const SWIPE_CLOSE_THRESHOLD = 80;

    const closeOrderDrawer = useCallback(() => {
        setOrderDrawerVisible(false);
        if (activeOrderRef.current) {
            setActiveOrder(activeOrderRef.current);
        }
    }, []);

    const handleOrderDrawerTouchStart = (e) => {
        orderDrawerSwipeRef.current.startY = e.touches[0].clientY;
        orderDrawerSwipeRef.current.fired = false;
    };

    const handleOrderDrawerTouchMove = (e) => {
        if (orderDrawerSwipeRef.current.fired) return;
        const el = e.currentTarget;
        const deltaY = e.touches[0].clientY - orderDrawerSwipeRef.current.startY;
        if (el.scrollTop <= 0 && deltaY > SWIPE_CLOSE_THRESHOLD) {
            orderDrawerSwipeRef.current.fired = true;
            closeOrderDrawer();
        }
    };
```

with:

```js
    // Closing the order sheet (button, mask, Escape or the swipe-down that
    // IosSheet handles) publishes the sheet's edits to the active-order bar.
    const closeOrderDrawer = useCallback(() => {
        setOrderDrawerVisible(false);
        if (activeOrderRef.current) {
            setActiveOrder(activeOrderRef.current);
        }
    }, []);
```

- [ ] **Step 4: Render the order sheet instead of the drawer**

Replace:

```jsx
            {/* Order Drawer (mobile - shows active order details) */}
            <Drawer
                title={
                    <Flex align="center" gap={8}>
                        <Badge count={activeOrder?.items?.length || 0} size="small" overflowCount={99}>
                            <ShoppingCartOutlined style={{fontSize: 18, color: 'var(--if-tint)'}}/>
                        </Badge>
                        <span style={{fontWeight: 600}}>{t.activeOrder} #{activeOrder?.id}</span>
                    </Flex>
                }
                placement="bottom"
                closable={true}
                open={orderDrawerVisible && showOrderPanel}
                onClose={closeOrderDrawer}
                height="85vh"
                className="m-order-drawer"
                destroyOnHidden
                styles={{
                    body: {padding: 0, overflow: 'hidden'},
                }}
            >
                {showOrderPanel && (
                    <div
                        onTouchStart={handleOrderDrawerTouchStart}
                        onTouchMove={handleOrderDrawerTouchMove}
                        style={{
                            height: '100%',
                            overflowY: 'auto',
                            overscrollBehaviorY: 'contain',
                            padding: '12px 16px 24px',
                        }}
                    >
                        <OrderPanel
                            order={activeOrder}
                            onOrderUpdate={handleOrderUpdate}
                            onSaveForLater={handleSaveForLater}
                            onProceedToPayment={handleProceedToPayment}
                            onDeleteOrder={handleDeleteActiveOrder}
                            onChangeCustomer={() => setChangeCustomerOpen(true)}
                            notify={notify}
                            isMobileDrawer={true}
                            confirmDisabled={activeOrderOffline || activeOrderPending > 0}
                        />
                    </div>
                )}
            </Drawer>
```

with:

```jsx
            {/* Order sheet: the active order's cart (step 1) and delivery
                (step 2). The idle bar opens the empty cart sheet instead. */}
            {showOrderPanel && (
                <OrderSheet
                    open={orderDrawerVisible}
                    order={activeOrder}
                    onClose={closeOrderDrawer}
                    onOrderUpdate={handleOrderUpdate}
                    onSaveForLater={handleSaveForLater}
                    onProceedToPayment={handleProceedToPayment}
                    onDeleteOrder={handleDeleteActiveOrder}
                    onChangeCustomer={() => setChangeCustomerOpen(true)}
                    notify={notify}
                    confirmDisabled={activeOrderOffline || activeOrderPending > 0}
                />
            )}
```

- [ ] **Step 5: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 68 suites, 470 tests.

- [ ] **Step 6: Check nothing still points at the drawer**

Run from `barcode-scanner-frontend/`:

```bash
grep -n "import OrderPanel\|<OrderPanel\|<Drawer\|orderDrawerSwipeRef\|SWIPE_CLOSE_THRESHOLD\|handleOrderDrawerTouch\|m-order-drawer\|ShoppingCartOutlined\|<Badge" src/components/UserDashboard/UserDashboard.js
npx eslint src/components/UserDashboard/UserDashboard.js src/components/UserDashboard/OrderSheet.js src/components/UserDashboard/CartItemRow.js src/components/UserDashboard/DeliveryStep.js src/components/UserDashboard/useSkuStock.js src/components/UserDashboard/useDebouncedField.js src/components/UserDashboard/cartSheetView.js src/components/UserDashboard/deliveryView.js src/components/UserDashboard/GiftCounter.js
```

Expected: the grep prints nothing (`showOrderPanel` is an existing variable and stays). ESLint reports 0 errors and exactly the 7 pre-existing `UserDashboard.js` warnings (`'Collapse'`, `'Result'`, `'ShoppingOutlined'`, `'InboxOutlined'`, `'colorBgContainer'`, `'colorTextSecondary'`, `'colorBorderSecondary'`); any other warning is a mistake in this task — fix it.

Then compile-check: check port 3005 is free (`netstat -ano | grep ":3005 " | grep LISTENING`; use 3006 otherwise), run `PORT=3005 BROWSER=none npm start` in the background, wait for `webpack compiled` with no `Failed to compile` and no `no-undef`, and stop only that process.

- [ ] **Step 7: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js
git diff --cached --name-only
git commit -m "feat(order-sheet): open the active order in the order sheet" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Remove the order panel and its dead styles

**Files:**
- Delete: `barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js`
- Modify: `barcode-scanner-frontend/src/index.css`

**Interfaces:**
- Consumes: nothing new. After Task 7 nothing imports `OrderPanel` or uses its classes; Step 1 proves it before deleting.

- [ ] **Step 1: Prove the code is dead**

Run from `barcode-scanner-frontend/`:

```bash
grep -rn "from './OrderPanel'\|<OrderPanel" src --include=*.js
grep -rnE "m-(order-panel|order-panel-drawer|order-header-card|customer-bar|order-items-list|order-item-card|item-delete-btn|qty-stepper|qty-btn|qty-input|unit-select|discount-input|discount-mode|order-total-bar|order-actions|order-action-btn|delivery-radio|order-drawer|order-item-group-expanded|warehouse-subrow|cart-card|cart-card-header|cart-card-thumb|cart-card-title|cart-table|cart-row|cart-cell|cart-row-header|cart-inline-edit|cart-row-gift|cart-row-gift-full|gift-line|gift-pill|gift-mini|gift-mini-count|gift-chip|gift-sum|cart-card-footer|cart-card-warning|cart-card-others)([^-a-z]|$)" src --include=*.js | grep -v "src/components/UserDashboard/OrderPanel.js"
```

Expected: both print nothing. If a line prints, stop and report it instead of deleting.

- [ ] **Step 2: Delete the order panel**

From the repo root:

```bash
git rm barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js
```

(`git rm` stages the deletion itself; do not `git add` this path later.)

- [ ] **Step 3: Delete the order panel, cart table, gift pink and drawer CSS**

From `barcode-scanner-frontend/`:

```bash
node -e "
const fs = require('fs');
const file = 'src/index.css';
let css = fs.readFileSync(file, 'utf8');
const once = (marker) => {
    const at = css.indexOf(marker);
    if (at < 0 || css.indexOf(marker, at + 1) >= 0) throw new Error('expected exactly one: ' + marker);
    return at;
};
const cut = (start, end) => {
    const a = once(start);
    const b = once(end);
    if (b <= a) throw new Error('markers out of order: ' + start);
    console.log('removed', css.slice(a, b).split('\n').length - 1, 'lines before', end);
    css = css.slice(0, a) + css.slice(b);
};
cut('/* ===== Order Panel (Mobile) ===== */', '/* Orders tab list: white ground now that /dashboard has no content card */');
cut('/* Delivery radio full-width */', '/* ===== Search Drawer ===== */');
cut('.m-order-item-group-expanded {', '.search-drawer .ant-drawer-header {');
cut('/* ===== Desktop overrides (larger screens) ===== */', '/* ===== Empty State ===== */');
fs.writeFileSync(file, css);
"
```

Expected output, four lines:

```
removed 115 lines before /* Orders tab list: white ground now that /dashboard has no content card */
removed 16 lines before /* ===== Search Drawer ===== */
removed 388 lines before .search-drawer .ant-drawer-header {
removed 7 lines before /* ===== Empty State ===== */
```

If it throws, nothing was written (the file is saved only after all four cuts): stop and report the output. If it ran but a count differs, stop before committing and report the output together with `git diff --stat src/index.css`.

- [ ] **Step 4: Verify the removals left nothing behind**

Run from `barcode-scanner-frontend/`:

```bash
grep -rnE "m-(order-panel|order-header-card|customer-bar|order-items-list|order-item-card|item-delete-btn|qty-stepper|qty-btn|qty-input|unit-select|discount-input|discount-mode|order-total-bar|order-actions|order-action-btn|delivery-radio|order-drawer|order-item-group-expanded|warehouse-subrow|cart-card|cart-table|cart-row|cart-cell|cart-inline-edit|gift-line|gift-pill|gift-mini|gift-chip|gift-sum)([^-a-z]|$)" src
grep -rn "OrderPanel.js\|from './OrderPanel'" src
grep -c "Order sheet (OrderSheet.js" src/index.css
grep -n "Search Drawer\|search-drawer .ant-drawer-header\|Empty State\|m-incomplete-order-row {" src/index.css
```

Expected: the first two print nothing; the third prints `1`; the fourth prints the `Search Drawer` heading, the `.search-drawer .ant-drawer-header {` rule, the `Empty State` heading and the `.m-incomplete-order-row {` rule (these survive).

- [ ] **Step 5: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 68 suites, 470 tests.

- [ ] **Step 6: Commit**

```bash
git add barcode-scanner-frontend/src/index.css
git diff --cached --name-only
git commit -m "refactor(order-sheet): remove the order panel and its table, gift and drawer styles" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Expected `git diff --cached --name-only` output: `OrderPanel.js` (from Step 2) and `index.css`, nothing else.

---

### Task 9: Browser verification of phase 3b

**Files:**
- Modify: `docs/superpowers/specs/2026-09-17-ios-redesign-phase3-order-sheets-design.md` (status line only)

Screenshots go to your scratchpad directory or the Playwright output folder; never commit them (never stage `.playwright-mcp/`). Keep a written log of every value you change in the dev database — Step 12 restores all of them.

- [ ] **Step 1: Check the ports are free**

Run: `netstat -ano | grep -E ":(8001|3005|8097) " | grep LISTENING`
Expected: nothing. If a port is taken it may belong to another session: use 8002 / 3006 / 8096 instead everywhere below. Never stop or reuse a server on 8000, 3000 or 8099.

- [ ] **Step 2: Record the dev database values this check changes**

From `backend/` (Bash). Georgian names need UTF-8 output on this Windows console, hence `PYTHONIOENCODING`:

```bash
uv run python manage.py migrate
PYTHONIOENCODING=utf-8 uv run python manage.py shell -c "
from users.models import User
from core.models import PurchaseOrder, Product
u = User.objects.get(username='gift-tester')
o = u.organization
print('ORG_ID', o.id)
print('URL', repr(o.web_service_url))
print('WAREHOUSES', list(u.warehouses.values_list('code', 'name')))
print('DISCOUNT', u.can_apply_discount, u.max_discount_percent)
print('DEVICE', repr(u.bound_device_id))
print('MAX_ORDER_ID', PurchaseOrder.objects.order_by('-id').values_list('id', flat=True).first())
print('PRODUCTS', list(Product.objects.filter(organization=o, is_active=True).exclude(article='').values_list('sku', 'article', 'name')[:5]))
"
```

Copy every printed value into your log. (On 2026-09-17 org 1 pointed at `http://127.0.0.1:8099`, gift-tester had `WH-TEST` "Test Warehouse" and `W1` "Main Warehouse", no discount permission, and the catalog held `SEED-PAN-1` "ალუმინის ტაფა 24სმ" among others — use the values you print, not these.)

Then point the organization at this check's mock 1C and unbind the consultant's device:

```bash
uv run python manage.py shell -c "
from users.models import User
from core.models import Organization
u = User.objects.get(username='gift-tester')
print(Organization.objects.filter(id=u.organization_id).update(web_service_url='http://127.0.0.1:8097'))
print(User.objects.filter(username='gift-tester').update(bound_device_id=''))
"
```

Expected: `1` and `1`.

- [ ] **Step 3: Start a mock 1C stock server**

Write this file to your scratchpad directory (NOT the repo) as `mock1c_phase3.py`, replacing the `MINE` list with the `WAREHOUSES` pairs printed in Step 2 (code, name — the frontend matches "my warehouses" by NAME, so the names must be exact):

```python
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MINE = [("WH-TEST", "Test Warehouse"), ("W1", "Main Warehouse")]  # from Step 2
OTHER = ("VERIFY-OTHER", "Verify Other Warehouse")  # returned only for an all-warehouse lookup
FREE_AND_RESERVED = [(12, 2), (3, 0)]


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if not self.path.endswith("/HS/ConsultWebExchange/GetStockAndPrices"):
            self.send_response(404)
            self.end_headers()
            return
        sku = self.headers.get("Sku", "")
        requested = [c.strip() for c in (self.headers.get("Warehouse") or "").split(",") if c.strip()]
        stock = []
        for (code, name), (free, reserved) in zip(MINE, FREE_AND_RESERVED):
            if not requested or code in requested:
                stock.append({"warehouse": code, "warehouse_name": name,
                              "quantity": free, "reserve": reserved, "price": 45.0})
        if not requested:
            stock.append({"warehouse": OTHER[0], "warehouse_name": OTHER[1], "quantity": 7,
                          "reserve": 0, "price": 49.0, "discountpercent": 5, "discountedprice": 46.55})
        body = json.dumps({"sku": sku, "article": sku, "sku_name": "Verify product", "price": 45.0,
                           "unit": "ცალი", "img_url": [], "stock": stock},
                          ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        # CreateOrder and CheckClient are not mocked: the backend reports the
        # failure, which is what this check records.
        self.send_response(404)
        self.end_headers()

    def log_message(self, fmt, *args):
        print(self.command, self.path, "Sku=", self.headers.get("Sku"),
              "Warehouse=", self.headers.get("Warehouse"), flush=True)


ThreadingHTTPServer(("127.0.0.1", 8097), Handler).serve_forever()
```

Start it in the background with the global Python: `python <scratchpad>/mock1c_phase3.py`. It must be `ThreadingHTTPServer`: a single-threaded server wedges on the browser's preconnects.

- [ ] **Step 4: Start the backend on 8001**

From `backend/` (Bash), in the background, with `FERNET_KEY` set to the value in the `backend` entry of `.claude/launch.json` (the org's stored 1C password is encrypted with it; a wrong key makes product search fail on decrypt):

```bash
DEBUG=true CORS_ALLOWED_ORIGINS=http://localhost:3005 FERNET_KEY=<key from .claude/launch.json> uv run python manage.py runserver 8001
```

Check: `curl -s http://127.0.0.1:8001/api/v1/health/` prints `{"status": "ok"}` (or `{"status":"ok"}`).

- [ ] **Step 5: Start the frontend on 3005**

From `barcode-scanner-frontend/`, in the background:

```bash
REACT_APP_API_BASE_URL=http://localhost:8001 PORT=3005 BROWSER=none npm start
```

Wait for `webpack compiled`.

- [ ] **Step 6: Let the consultant discount for this check**

If Step 2 printed `DISCOUNT False …`, grant it for the check (Step 12 restores the recorded values). From `backend/`:

```bash
uv run python manage.py shell -c "
from users.models import User
print(User.objects.filter(username='gift-tester').update(can_apply_discount=True, max_discount_percent='20.00'))
"
```

Expected: `1`. The permission reaches the frontend through the login payload, so do this before logging in.

- [ ] **Step 7: Consultant at 393×852, light**

With Playwright: resize to 393×852, open `http://localhost:3005/login`, log in as `gift-tester` / `verify-1234`. On `/dashboard`, freeze motion (repeat after every reload): run `() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'; document.head.appendChild(s); }`. When a pane click on a bottom-bar button does not land, use `el.click()` through evaluate; antd `Segmented` options are clicked on their `.ant-segmented-item` label, not the hidden radio input.

Build an order: open the catalog (round search tab), pick the first product from Step 2's `PRODUCTS`, add 1 from the first warehouse; in the lookup that opens choose "გაგრძელება კლიენტის გარეშე". Open the same product again, tap "ყველა საწყობის ნახვა", pick "Verify Other Warehouse", set 2 and add. Open a second product from `PRODUCTS` and add 1. Record the order id.

Screenshot and check each:
1. **Cart (step 1)** — tap the active-order bar: a sheet with × at left, "კალათა" and "1 / 2 · პროდუქტები" in the middle, a round ⋯ at right; a client row with a person glyph, "საცალო მომხმარებელი" and a chevron; one section per warehouse whose header reads "<warehouse name>" left and "N პროდუქტი" right; each row: package thumb, name (2 lines max), line total in label colour, "<price> ₾ / ცალი" in link colour with a small chevron, "ნაშთი: N" once the stock lookup answers, the stepper, and the "საჩუქარი" pill; the bar "სულ · 4 ცალი" with the order total and a green "შემდეგი". A row with quantity 1 shows a red trash icon where the stepper's − would be.
2. **Gift** — on the 2-unit row tap "საჩუქარი": the pill turns soft green with a check and reads "1/2 საჩუქარი", a small "− 1 / 2 +" stepper appears, the row's line total drops by one unit and the bar reads "სულ · 4 ცალი · 1 საჩუქარი".
3. **Discount** — tap the unit-price line of any row: two fields "ფასი ₾" and "ფასდაკლება %" open under it. Type 10 in the percent field and tap elsewhere: the line shows the struck base price, the new unit price and "· −10%", and the line total drops. Type 50 (above the 20 % limit) and tap elsewhere: either the field holds it to 20 % (the row then shows −20 %) or a red notification reports the backend's `DISCOUNT_EXCEEDS_LIMIT` and the row keeps 10 %; record which.
4. **Quantity and delete** — tap + on a row: the total grows. On a quantity-1 row tap the trash icon: a confirmation "გსურთ წაშლა?" appears above the sheet; choose "არა" (keep the row).
5. **⋯ menu** — tap ⋯: "შენახვა მოგვიანებით", "მომხმარებლის შეცვლა", a divider and a red "შეკვეთის წაშლა" appear above the sheet. Tap "მომხმარებლის შეცვლა": the client lookup opens on top of the sheet; close it with ×.
6. **Delivery (step 2)** — tap "შემდეგი": the navbar shows a round back arrow, "მიწოდება" and "2 / 2", no ⋯. Tap "მიწოდება" in the segments: address, date, time, delivery notes and comment rows appear with "არ არის მითითებული" placeholders. Type an address, tap outside: the network log shows a PATCH with `delivery_address`. Pick a date: the row shows it (YYYY-MM-DD). Pick 12:00 and 15:00. Tap "სხვა" in the recipient row: first name, last name and phone fields appear; type `123` in the phone: "ტელეფონის ფორმატი არასწორია (+995 + 9 ციფრი)" shows. Clear it. The summary shows "საცალო მომხმარებელი", the order's warehouses joined with ", ", and "4 ცალი". Close the sheet and reopen it from the bar: it opens on step 1; tap "შემდეგი": the address, date and times you set are still shown.
7. **Confirm** — on step 2 tap "შეკვეთის დადასტურება": a confirmation "გსურთ შეკვეთის დადასტურება და გადახდაზე გადასვლა?" appears above the bar. Tap "დიახ". The mock does not implement CreateOrder, so expect a red notification (for example the external-service or order-create error) and the sheet to stay open on step 2 with the order still active; if the backend instead confirms the order, expect the sheet to close and the "print invoice" dialog. Record exactly which happened (notification text, the PATCH response code and body from the network log).
8. **Save for later and resume** — if the order is still active, open ⋯ on step 1 and tap "შენახვა მოგვიანებით": the sheet closes, a success notification shows and the bar is idle. Open the Orders tab, tap the draft: the order sheet opens on step 1 with the same rows.

- [ ] **Step 8: Consultant at 393×852, dark**

Close the sheet, switch with the account menu ("მუქი რეჟიმი"), re-inject the motion style, and screenshot the cart step (with the gift row and the open price editor) and the delivery step with "მიწოდება" and "სხვა" selected. Check: slate rows on the dark grouped ground, readable labels and placeholders, the soft green gift pill, the selected segments filled green with white bold labels, the glass bar dark and translucent.

- [ ] **Step 9: Delete the order from the ⋯ menu**

Back in light mode, open the order sheet, tap ⋯ → "შეკვეთის წაშლა": a confirmation "გსურთ შეკვეთის წაშლა?" appears; tap "დიახ": the sheet closes, "შეკვეთა წარმატებით წაიშალა" shows and the bar is idle.

- [ ] **Step 10: Delete the orders this check created**

From `backend/`, with `MAX_ORDER_ID` from Step 2 (use `0` if it printed `None`):

```bash
uv run python manage.py shell -c "
from core.models import PurchaseOrder
qs = PurchaseOrder.objects.filter(id__gt=<MAX_ORDER_ID>, created_by__username='gift-tester')
print(list(qs.values_list('id', 'status')))
print(qs.delete())
"
```

List the deleted ids and statuses in your report. If Step 6 had to use the recent-scan fallback, also delete the catalog row the lookup created: `Product.objects.filter(organization_id=<ORG_ID>, sku='VERIFY-1').delete()`.

- [ ] **Step 11: Stop what you started**

Stop only the frontend, backend and mock 1C processes this task started (check with `netstat -ano | grep -E ":(8001|3005|8097) " | grep LISTENING` afterwards; a surviving node or python process holding a port can be stopped by its PID). Delete `mock1c_phase3.py` from the scratchpad.

- [ ] **Step 12: Restore the dev database**

From `backend/`, with the exact values recorded in Step 2 (`URL` including its quotes' contents, `DISCOUNT`, `DEVICE`):

```bash
uv run python manage.py shell -c "
from users.models import User
from core.models import Organization
u = User.objects.get(username='gift-tester')
print(Organization.objects.filter(id=u.organization_id).update(web_service_url='<URL from Step 2>'))
print(User.objects.filter(username='gift-tester').update(bound_device_id='<DEVICE from Step 2>', can_apply_discount=<True|False from Step 2>, max_discount_percent='<max from Step 2>'))
"
```

Then rerun Step 2's printing command (not the `update` one) and confirm `URL`, `DISCOUNT` and `DEVICE` match your log exactly.

- [ ] **Step 13: Mark phase 3 implemented**

In `docs/superpowers/specs/2026-09-17-ios-redesign-phase3-order-sheets-design.md`, replace:

```markdown
Date: 2026-09-17 · Status: 3a implemented, 3b not yet implemented
```

with:

```markdown
Date: 2026-09-17 · Status: implemented
```

If a screenshot showed a defect, fix it in the file that owns it, rerun the suite (68 suites, 470 tests), commit the fix separately by path, and describe it in your report before this step.

- [ ] **Step 14: Commit**

```bash
git add docs/superpowers/specs/2026-09-17-ios-redesign-phase3-order-sheets-design.md
git diff --cached --name-only
git commit -m "docs: mark phase 3 of the iOS redesign implemented" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

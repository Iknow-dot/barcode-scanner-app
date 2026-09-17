# iOS redesign phase 5a — orders list Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the consultant's Orders tab into the canvas screen: three status segments over grouped, date-sectioned rows with avatars and relative times, and no per-row status tags.

**Architecture:** A pure `ordersListView.js` owns every projection and the clock arithmetic; a new `OrdersView.js` component owns the fetching, the segments and the list, lifted out of `UserDashboard.js`; `UserDashboard.js` keeps the handlers and just renders it.

**Tech Stack:** React 18 (CRA), antd 6, Jest + React Testing Library, the `--if-*` tokens and `ios.css` primitives from phases 1–4.

**Spec:** `docs/superpowers/specs/2026-09-18-ios-redesign-phase5-orders-scanner-catalog-design.md`

## Global Constraints

- All paths under `barcode-scanner-frontend/`. Test command from that
  directory: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`.
  Baseline: 73 suites / 560 tests passing.
- **Do not modify `src/utils/orderStatusColor.js` or its test.** It is shared
  with `components/SystemAdminDashboard/OrdersTab.js`, which keeps using it.
  The consultant list simply stops calling it.
- **Do not modify `addFlow.js`, `addFlow.test.js`, `clientCreateRecovery.js`
  or `clientCreateRecovery.test.js`.**
- No literal colours — `var(--if-*)` only. Every string through `t`, in both
  `ka` and `en`, each key exactly once per locale.
- Every network fetch this plan touches gets a monotonic sequence guard so an
  older response cannot land last (the pattern in `FindProductDrawer.js`'s
  `browseSeqRef` and phase 4's `ClientLookupSheet`).
- Row behaviour must not change: tapping a draft resumes it, the printer icon
  prints, the trash icon deletes behind its confirm, and both icons stop
  propagation so they never also open the row.
- Commit per task, `git add` by path only (shared checkout), never push.
  Trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

### Task 1: The orders view model

**Files:**
- Create: `src/components/UserDashboard/ordersListView.js`
- Test: `src/components/UserDashboard/ordersListView.test.js`

**Interfaces:**
- Produces:
  ```js
  export const ORDER_SEGMENTS = ['draft', 'confirmed', 'completed'];
  export const segmentLabelKey = (segment) => string;       // i18n key
  export const segmentQuery = (segment, {userId}) => object; // params for getOrders
  export const initialsOf = (name) => string;               // '' for a retail order
  export const relativeTime = (iso, now) => {key, value};   // {key:'justNow'} | {key:'minutesAgo', value:25} | {key:'hoursAgo', value:2} | {key:'clock', value:'18:20'} | {key:'none'}
  export const orderRow = (order, t, now) => ({key, initials, isRetail, name, meta, total, time, isResumable});
  export const groupByDay = (orders, now) => [{key, headingKey, headingValue, orders}];
  export const emptyCopyKey = (segment, isSearching) => string;
  ```
- Consumes: `utils/orderDisplay.js`'s `displayCustomerName` (already tested — reuse it, do not reimplement the retail-label fallback).

- [ ] **Step 1: Write the failing tests**

`now` is always passed in, never read from the system clock, so these are
deterministic:

```js
const NOW = new Date('2026-09-18T12:00:00Z');

describe('relativeTime', () => {
    it('reads as just now under a minute', () => {
        expect(relativeTime('2026-09-18T11:59:30Z', NOW)).toEqual({key: 'justNow'});
    });
    it('counts minutes, then hours', () => {
        expect(relativeTime('2026-09-18T11:35:00Z', NOW)).toEqual({key: 'minutesAgo', value: 25});
        expect(relativeTime('2026-09-18T10:00:00Z', NOW)).toEqual({key: 'hoursAgo', value: 2});
    });
    it('falls back to a clock time on an earlier day', () => {
        expect(relativeTime('2026-09-17T18:20:00Z', NOW)).toEqual({key: 'clock', value: '18:20'});
    });
});

describe('groupByDay', () => {
    it('heads today and yesterday by name and older days by date', () => {
        const groups = groupByDay([
            {id: 1, created_at: '2026-09-18T11:00:00Z'},
            {id: 2, created_at: '2026-09-17T18:20:00Z'},
            {id: 3, created_at: '2026-09-02T09:00:00Z'},
        ], NOW);
        expect(groups.map((g) => g.headingKey)).toEqual(['today', 'yesterday', 'date']);
        expect(groups[0].orders).toHaveLength(1);
    });
    it('keeps a day boundary even when the two orders are minutes apart', () => {
        const groups = groupByDay([
            {id: 1, created_at: '2026-09-18T00:05:00Z'},
            {id: 2, created_at: '2026-09-17T23:55:00Z'},
        ], NOW);
        expect(groups).toHaveLength(2);
    });
});

describe('initialsOf', () => {
    it('takes the first letter of the first two words', () => {
        expect(initialsOf('გიორგი ბერიძე')).toBe('გბ');
        expect(initialsOf('ნინო')).toBe('ნ');
        expect(initialsOf('')).toBe('');
    });
});

describe('segmentQuery', () => {
    it('asks for my own drafts, and org-wide for the other two', () => {
        expect(segmentQuery('draft', {userId: 7})).toEqual({status: 'draft', created_by: 7});
        expect(segmentQuery('confirmed', {userId: 7})).toEqual({status: 'confirmed'});
    });
});
```

Also cover `orderRow`: the meta line reads `#1048 · 3 პროდუქტი` (and omits the
product count when `items_count` is 0), `isRetail` picks the cart glyph so
`initials` is empty, `total` is absent when `order.total == null`, and
`isResumable` is true only for `draft`.

- [ ] **Step 2: Run them and watch them fail** (module not found).

- [ ] **Step 3: Implement the module.** Keep it pure — no React, no antd, no
`Date.now()` inside; the caller passes `now`.

- [ ] **Step 4: Tests green, then commit**

```bash
git add src/components/UserDashboard/ordersListView.js src/components/UserDashboard/ordersListView.test.js
git commit -m "feat(orders): add the orders list view model"
```

---

### Task 2: Strings and the row primitives

**Files:**
- Modify: `src/i18n/translations.js`
- Modify: `src/theme/ios.css`
- Test: `src/theme/iosCss.test.js`

**Interfaces:**
- Produces: the keys `ordersSegmentOpen`, `ordersSegmentConfirmed`, `ordersSegmentCompleted`, `ordersSearchPlaceholder`, `today`, `yesterday`, `justNow`, `minutesAgo`, `hoursAgo`, `noOrdersInSegment`, `productsCount`; the classes `.if-avatar`, `.if-group.is-avatar-inset`, `.if-row-trailing`.
- Consumes: nothing.

- [ ] **Step 1: Add the strings to both locales.** Georgian from the canvas:
`ღია`, `დადასტურებული`, `დასრულებული`, `კლიენტით ძიება`, `დღეს`, `გუშინ`,
`ახლახან`, `{n} წუთის წინ`, `{n} სთ წინ`. `productsCount` is the
`3 პროდუქტი` unit. Grep each key first — several may already exist.

- [ ] **Step 2: Add the primitives to `ios.css`:**

```css
/* Round monogram at the head of a row (an order's customer). */
.if-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    flex: none;
    border-radius: 20px;
    background: var(--if-fill);
    color: var(--if-label-2);
    font-size: 15px;
    font-weight: 600;
}

/* Separators start past the avatar rather than at the row's edge. */
.if-group.is-avatar-inset > * + *::before { left: 68px; }

/* The right-hand column of a row: a value over a quiet caption. */
.if-row-trailing {
    flex: none;
    text-align: right;
}
```

- [ ] **Step 3: Extend `iosCss.test.js`** with a case asserting the three new
selectors exist and carry no `#` literal.

- [ ] **Step 4: Suite green, then commit**

```bash
git add src/i18n/translations.js src/theme/ios.css src/theme/iosCss.test.js
git commit -m "feat(orders): add the orders segment strings and row primitives"
```

---

### Task 3: The orders view

**Files:**
- Create: `src/components/UserDashboard/OrdersView.js`
- Test: `src/components/UserDashboard/OrdersView.test.js`

**Interfaces:**
- Consumes: `ordersListView.js` (all exports), `orderService.getOrders`, `IosIcon`, `.if-search` from phase 4.
- Produces: `OrdersView({userId, activeOrderId, onOpenOrder, onPrint, onDelete, onNewOrder})`.

- [ ] **Step 1: Write the failing component tests.** Mock `../../api/services`
and use fake timers for the 300 ms search debounce:
selecting a segment issues `getOrders` with that segment's params; the `ღია`
segment excludes the active order; a search inside a segment sends both
`customer_search` and the segment's `status`; an older response that resolves
after a newer one is discarded (resolve two out of order and assert the newer
one's rows render); rows render grouped under `დღეს` / `გუშინ`; a draft row's
tap calls `onOpenOrder` while a confirmed row's does not; the printer and trash
icons call their handlers and do NOT also call `onOpenOrder`; the empty state
differs between an idle segment and a fruitless search.

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement the view.** Lift the logic from
`UserDashboard.js:206-253` (fetch, debounce) and `:873-1012` (rows, tab), with
these changes: one fetch keyed on `[segment, query]` with a sequence ref;
**both** paths unwrap `result.data?.results ?? result.data ?? []`; no
`Tag`/`List`/`List.Item.Meta` — `.if-group.is-avatar-inset` of `.if-row`s built
from `orderRow`, with `.if-section-header` per day group from `groupByDay`;
`.if-search` for the field; `.if-seg` for the segments; the navbar `+` stays.

- [ ] **Step 4: Tests green, then commit**

```bash
git add src/components/UserDashboard/OrdersView.js src/components/UserDashboard/OrdersView.test.js
git commit -m "feat(orders): add the segmented, date-grouped orders view"
```

---

### Task 4: Wire it in and remove the old tab

**Files:**
- Modify: `src/components/UserDashboard/UserDashboard.js`
- Modify: `src/index.css` (drop rules that die with the old markup)

**Interfaces:**
- Consumes: `OrdersView` from Task 3.

- [ ] **Step 1: Render `OrdersView`** where `renderOrdersTab()` was called,
passing the existing handlers: `handleContinueOrder`, `printInvoice`,
`handleDeleteIncompleteOrder`, `handleStartFreshOrder`, plus `userId` and the
active order's id.

- [ ] **Step 2: Delete what moved** — `renderOrderRow`, `renderOrdersTab`,
`fetchIncompleteOrders`, the search-debounce effect and the state they owned
(`incompleteOrders`, `searchResults`, `customerSearch`, the two loading flags),
**but keep anything still used elsewhere**: grep each symbol before deleting
it. `handleDeleteIncompleteOrder` prunes lists that now live in `OrdersView` —
have it call back into the view's refresh instead, and say in the report how
you did it.

- [ ] **Step 3: Prune dead CSS** — `.m-orders-list` and
`.m-incomplete-order-row` in `index.css` if nothing references them any more
(grep first; `.m-incomplete-order-row` is named in a memory note about browser
verification, so if it survives in another screen, keep it).

- [ ] **Step 4: Run the full suite, then commit**

```bash
git add src/components/UserDashboard/UserDashboard.js src/index.css
git commit -m "refactor(orders): render the orders view and drop the antd list"
```

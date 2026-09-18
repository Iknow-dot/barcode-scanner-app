# iOS redesign phase 5c — catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the catalog from a bottom drawer to a full tab screen, matching the canvas, without losing the two stale-response guards or the coverage `FindProductDrawer.test.js` already provides.

**Architecture:** `CatalogView.js` becomes a tab screen rendered by `UserDashboard` beside Home and Orders; the trailing search tab stops being a separate button and becomes the tab that selects it. The tested pure modules (`catalogBrowse.js`, `categoryTileStyle.js`) and the signed-image contract are untouched.

**Tech Stack:** React 18 (CRA), antd 6, Jest + React Testing Library, the `--if-*` tokens and `ios.css` primitives from phases 1–4.

**Spec:** `docs/superpowers/specs/2026-09-18-ios-redesign-phase5-orders-scanner-catalog-design.md` (phase 5c section)

## Global Constraints

- All paths under `barcode-scanner-frontend/`. Test command from that
  directory: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`.
  Baseline: 79 suites / 688 tests passing.
- **`FindProductDrawer.test.js` is the regression gate.** It pins the 300 ms
  search debounce, the spinner-vs-empty ordering, both stale-response guards
  (including "ascending to root invalidates an in-flight browse"), the
  breadcrumb chrome at three depths, a product row firing `onSelectProduct`,
  and the no-image placeholder. Those behaviours must still be pinned when the
  component is renamed and restyled — port the tests, do not drop them.
- **Never modify** `catalogBrowse.js`, `categoryTileStyle.js` or their tests
  (pure and fully covered), nor `addFlow.js`, `clientCreateRecovery.js`,
  `orderStatusColor.js` or their tests.
- **The category tiles keep their fixed pastel backgrounds and fixed dark
  ink.** That was a deliberate phase 1 decision: `--if-label` flips to near
  white in dark mode and would be invisible on a pastel tile.
  `categoryTileStyle.test.js` pins the palette.
- **Images are signed relative proxy paths minted by the backend.** The
  frontend must never rebuild those URLs — `catalogService.imageUrl` only
  joins the path onto the API base. Do not touch that contract.
- No literal colours beyond the sanctioned tile pastels/ink; strings via `t`
  in both `ka` and `en`, each key exactly once per locale.
- The Jest run is pinned to `Asia/Tbilisi` in `jest.globalSetup.js`; never add
  a per-file `process.env.TZ`.
- Commit per task, `git add` by path only (shared checkout), never push.
  After each commit run `git show --stat`; if files you did not stage appear,
  soft-reset and recommit only yours. Trailer:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

### Task 1: The catalog as a screen

**Files:**
- Create: `src/components/UserDashboard/CatalogView.js`, `CatalogView.css`
- Create: `src/components/UserDashboard/CatalogView.test.js` (ported from `FindProductDrawer.test.js`)
- Keep untouched: `catalogBrowse.js`, `categoryTileStyle.js`, `ProductImage.js`

**Interfaces:**
- Produces: `CatalogView({orderMode, onSelectProduct, onScan, allWarehouses, onAllWarehousesChange, resetToken})` — `resetToken` changes when the tab is re-tapped, which pops to the category root and clears the search (Task 2 supplies it).
- Consumes: `catalogService` (`categoryTree`, `listProducts`, `searchByName`, `imageUrl`), `catalogBrowse.js`, `categoryTileStyle.js`.

- [ ] **Step 1: Read `FindProductDrawer.js` in full** before writing anything.
The parts that must survive the move, each of which its tests pin:
  - `browseSeqRef` / `searchSeqRef` — two independent monotonic guards. The
    browse one has a subtle case: ascending to root invalidates an in-flight
    fetch **without starting a new one**. Keep that.
  - the 300 ms debounce and the 3-character minimum on the search;
  - `PAGE_SIZE = 25` and the "load more" appending;
  - the `treeLoaded` guard so the category tree is fetched once.

- [ ] **Step 2: Port the tests first**, renamed to `CatalogView.test.js` and
adapted to the new markup. They must fail against a missing `CatalogView`, then
pass. Do not weaken an assertion to make a port easier — if a test cannot be
expressed against the new markup, say so in the report rather than deleting it.
Then add the three the old file never had, which the code map flagged:
  - "load more" fetches the next page and appends rather than replacing;
  - the all-warehouses toggle round-trips its value;
  - the scan shortcut calls `onScan`.

- [ ] **Step 3: Build the screen to the canvas**
(`.claude/ios-mockups/src/Catalog.body.html`): `.if-large-header` with
`კატალოგი`; `.if-search` with a **trailing scan glyph** that calls `onScan`;
an `.if-group` row holding the `ყველა საწყობი` switch; `.if-section-header`
`კატეგორიები`; the 2-column tile grid with its existing fixed pastels and
monogram; and product rows on `.if-row` with the existing 56 px thumb.
Keep the breadcrumb/chip chrome for depth — it is tested.

- [ ] **Step 4: Replace the Drawer's autofocus.** The input currently focuses
via the Drawer's `afterOpenChange`, which will not exist. Focus it when the
screen becomes active instead, and **do not steal focus on every re-render** —
test that typing is not interrupted when a fetch resolves.

- [ ] **Step 5: Suite green, then commit**

```bash
git add src/components/UserDashboard/CatalogView.js src/components/UserDashboard/CatalogView.css src/components/UserDashboard/CatalogView.test.js
git commit -m "feat(catalog): add the catalog as a full screen"
```

---

### Task 2: Make the search tab a real tab

**Files:**
- Modify: `src/components/UserDashboard/TabBar.js`, `TabBar.test.js`
- Modify: `src/components/UserDashboard/tabSelection.js`, `tabSelection.test.js`

**Interfaces:**
- Produces: `TabBar` selects `'catalog'` through the same `onSelectTab` as the
  other tabs and marks the trailing button `is-on` when it is active;
  `nextTabAction` gains a `'pop-to-root'` result for re-tapping catalog.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests.** In `tabSelection.test.js`:
re-tapping `catalog` returns `'pop-to-root'`; re-tapping it is distinct from
`'pop-to-home'` (which stays the Products-with-a-result case); switching to it
from anywhere returns `'switch'`; the existing cases keep their results. In
`TabBar.test.js`: the trailing button carries `aria-current="page"` and the
`is-on` class when `activeTab === 'catalog'`, and calls `onSelectTab('catalog')`.

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement.** Keep the trailing button visually a round search
tab (`.if-search-tab`), not a third label in `.if-tabs` — the canvas shows it
apart, and it still only renders when the org has the catalog enabled. Keep
its `aria-label`.

- [ ] **Step 4: Suite green, then commit**

```bash
git add src/components/UserDashboard/TabBar.js src/components/UserDashboard/TabBar.test.js src/components/UserDashboard/tabSelection.js src/components/UserDashboard/tabSelection.test.js
git commit -m "feat(catalog): make the trailing search tab select the catalog"
```

---

### Task 3: Wire it in and delete the drawer

**Files:**
- Modify: `src/components/UserDashboard/UserDashboard.js`
- Delete: `src/components/UserDashboard/FindProductDrawer.js`, `FindProductDrawer.css`, `FindProductDrawer.test.js`
- Modify: `src/index.css` (drop rules that die with the drawer)

**Interfaces:**
- Consumes: `CatalogView` (Task 1), the tab changes (Task 2).

- [ ] **Step 1: Render `CatalogView`** where the tab content is chosen, beside
Home and `OrdersView`, and feed it the handlers the drawer had
(`handleSelectFromCatalog`, the all-warehouses state, and a scan handler).

- [ ] **Step 2: Repoint all four entry points.** They currently call
`handleOpenSearch` / `handleEmptyCartSearch` → `setDrawerVisible(true)`:
the trailing tab, Home's manual-search button, the empty cart's, and — added
in phase 5b — the scanner's manual-search pill. Each must now select the
catalog tab. **The scanner's pill must still close the scanner first**, so the
camera is released before the screen changes; phase 5b's `handleOpenSearch`
already does `setScannerOpen(false)` then opens the search — keep that
ordering when you change what "open the search" means.

- [ ] **Step 3: Delete the drawer and check for orphans.**

```bash
git rm src/components/UserDashboard/FindProductDrawer.js src/components/UserDashboard/FindProductDrawer.css src/components/UserDashboard/FindProductDrawer.test.js
```

Then grep `src/` for `FindProductDrawer`, `drawerVisible`, `search-drawer` and
any i18n key the drawer alone used; remove what is genuinely orphaned and say
in the report which keys you removed versus kept and why. `.search-drawer`
rules in `index.css` go with it.

- [ ] **Step 4: Run the full suite, then commit**

```bash
git add src/components/UserDashboard/UserDashboard.js src/index.css
git commit -m "refactor(catalog): open the catalog tab and remove the drawer"
```

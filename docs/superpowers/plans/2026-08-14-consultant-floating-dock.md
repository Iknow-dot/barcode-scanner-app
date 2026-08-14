# Consultant Floating Glass Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the consultant page's two-row bottom bar and floating cart bubble with a single detached floating "liquid glass" dock (Product · Orders · Scan orb · Search · Cart).

**Architecture:** Pure frontend change in three files. A new pure helper (`dockCartView`) derives the cart slot's view state and is the only unit-tested piece; the dock itself is presentational JSX in `UserDashboard.js` styled by new `.m-dock*` classes in `index.css`, wired to the five existing handlers. The old `.m-bottom-bar`, `.m-cart-fab`, and `.m-order-indicator` UI is deleted.

**Tech Stack:** React 18 (CRA), Ant Design 6 (`Badge` + `@ant-design/icons`), plain CSS in `src/index.css`, jest via `react-scripts test`.

**Spec:** `docs/superpowers/specs/2026-08-14-consultant-floating-dock-design.md`. Mockup reference: `.claude/consultant-dock-mockups.html`, Option C.

## Global Constraints

- All frontend commands run from `barcode-scanner-frontend/`. Always use the npm scripts (`npm test`, `npm run build`) — they carry the required `--openssl-legacy-provider` flag; never call `react-scripts` directly.
- Frontend only. No backend, no changes to `FindProductDrawer`, `OrderPanel`, `AddToCartSheet`, `BarcodeScanner`, or the order drawer contents.
- All user-visible strings go through `t.*` i18n keys — no hardcoded UI text (the `₾` currency suffix inside the helper is data formatting, not copy).
- Colors: accent `#1677ff` (light) / `#4096ff` (dark-theme accent), badge red `#ff4d4f` — match existing usage.
- Line numbers below are from commit `e29d478`. If they have drifted, locate the quoted code instead.
- This checkout may be shared with concurrent sessions: `git add` by explicit path only, never `git add -A`.

---

### Task 1: `dockCartView` helper

**Files:**
- Create: `barcode-scanner-frontend/src/components/UserDashboard/dockCartView.js`
- Test: `barcode-scanner-frontend/src/components/UserDashboard/dockCartView.test.js`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces: `dockCartView(activeOrder) -> {badgeCount: number, totalLabel: string|null, opensDrawer: boolean}` — default export. Task 2 imports it as `import dockCartView from './dockCartView';` and renders `totalLabel || t.cart` under the cart icon, `badgeCount` in the Badge, and branches the tap on `opensDrawer`.

- [ ] **Step 1: Write the failing test**

Create `barcode-scanner-frontend/src/components/UserDashboard/dockCartView.test.js`:

```js
import dockCartView from './dockCartView';

describe('dockCartView', () => {
    it('returns the empty state when there is no active order', () => {
        expect(dockCartView(null)).toEqual({
            badgeCount: 0,
            totalLabel: null,
            opensDrawer: false,
        });
        expect(dockCartView(undefined)).toEqual({
            badgeCount: 0,
            totalLabel: null,
            opensDrawer: false,
        });
    });

    it('derives badge count and formatted total from an active order', () => {
        const order = {
            id: 142,
            items: [{id: 1}, {id: 2}, {id: 3}],
            total: '145.50',
        };
        expect(dockCartView(order)).toEqual({
            badgeCount: 3,
            totalLabel: '145.50₾',
            opensDrawer: true,
        });
    });

    it('handles an order with no items array yet', () => {
        const order = {id: 7, total: '0.00'};
        expect(dockCartView(order)).toEqual({
            badgeCount: 0,
            totalLabel: '0.00₾',
            opensDrawer: true,
        });
    });

    it('returns a null total label when the order has no total', () => {
        const order = {id: 8, items: [{id: 1}]};
        expect(dockCartView(order)).toEqual({
            badgeCount: 1,
            totalLabel: null,
            opensDrawer: true,
        });
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `barcode-scanner-frontend/`):
```bash
npm test -- --watchAll=false --testPathPattern=dockCartView
```
Expected: FAIL — `Cannot find module './dockCartView'`.

- [ ] **Step 3: Write the implementation**

Create `barcode-scanner-frontend/src/components/UserDashboard/dockCartView.js`:

```js
/**
 * View state for the floating dock's cart slot.
 *
 * With an active order the slot shows an item-count badge and the running
 * total, and tapping it opens the order drawer. Without one it shows the
 * idle "cart" label, and tapping it opens the client-lookup modal to start
 * an order (opensDrawer: false).
 */
const dockCartView = (activeOrder) => {
    if (!activeOrder) {
        return {badgeCount: 0, totalLabel: null, opensDrawer: false};
    }
    const badgeCount = Array.isArray(activeOrder.items) ? activeOrder.items.length : 0;
    const totalLabel = activeOrder.total != null ? `${activeOrder.total}₾` : null;
    return {badgeCount, totalLabel, opensDrawer: true};
};

export default dockCartView;
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `barcode-scanner-frontend/`):
```bash
npm test -- --watchAll=false --testPathPattern=dockCartView
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/dockCartView.js barcode-scanner-frontend/src/components/UserDashboard/dockCartView.test.js
git commit -m "feat(frontend): dockCartView helper for dock cart slot state"
```

---

### Task 2: Dock markup, styles, and removal of the old bar/FAB/indicator

**Files:**
- Modify: `barcode-scanner-frontend/src/i18n/translations.js` (two one-line additions)
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js`
- Modify: `barcode-scanner-frontend/src/index.css`

**Interfaces:**
- Consumes: `dockCartView(activeOrder)` from Task 1 (default export, returns `{badgeCount, totalLabel, opensDrawer}`).
- Produces: DOM class `m-dock-cart` on the cart slot button — the fly-to-cart animation and pulse (this task) and the browser verification (Task 3) rely on it.

- [ ] **Step 1: Add the `cart` i18n key**

In `barcode-scanner-frontend/src/i18n/translations.js`:

In the Georgian block, after `client: 'კლიენტი',` (line 306), add:
```js
        cart: 'კალათა',
```

In the English block, after `client: 'Client',` (line 955), add:
```js
        cart: 'Cart',
```

- [ ] **Step 2: Remove the top order indicator from `renderScanTab`**

In `UserDashboard.js`, delete lines 906–926 — the whole block below. Keep the `OfflineBanner` block immediately above it.

```jsx
            {showOrderPanel && (
                <div
                    className="m-order-indicator"
                    onClick={() => setOrderDrawerVisible(true)}
                >
                    <Flex align="center" gap={8} style={{flex: 1, minWidth: 0}}>
                        <Badge count={activeOrder.items?.length || 0} size="small" overflowCount={99}>
                            <ShoppingCartOutlined style={{fontSize: 18, color: '#fff'}}/>
                        </Badge>
                        <Text className="m-order-indicator-text" ellipsis>
                            {t.activeOrder} #{activeOrder.id} · {displayCustomerName(activeOrder, t)}
                        </Text>
                    </Flex>
                    <Flex align="center" gap={4}>
                        <Text className="m-order-indicator-total">
                            {activeOrder.total} ₾
                        </Text>
                        <RightOutlined style={{color: '#fff', fontSize: 12}}/>
                    </Flex>
                </div>
            )}
```

- [ ] **Step 3: Replace the cart FAB and bottom bar with the dock**

In `UserDashboard.js`:

a) Import the helper (with the other `./` imports near the top, e.g. after `import formatConfirmError from './confirmError';`):
```js
import dockCartView from './dockCartView';
```

b) Derive the view state next to the other render-time derivations (after `const showOrderPanel = orderMode && activeOrder;`, line 897):
```js
    const cartView = dockCartView(showOrderPanel ? activeOrder : null);
```
(Passing `null` when `showOrderPanel` is false keeps the paused-order semantics of today's FAB: no order mode → idle cart slot.)

c) Delete lines 1287–1365 — everything from the `{/* Floating cart FAB — ... */}` comment through the closing of the `{!scannerOpen && !drawerVisible && (...)}` bottom-bar block (the FAB `<button className="m-cart-fab...">`, the `m-bottom-bar` div with its `m-action-row` and `m-tab-bar`), and insert in the same place:

```jsx
                {/* ===== Floating glass dock: tabs + scan + search + cart ===== */}
                {!scannerOpen && !drawerVisible && (
                    <div className="m-dock">
                        <button
                            type="button"
                            className={`m-dock-slot ${activeTab === 'scan' ? 'on' : ''}`}
                            onClick={() => setActiveTab('scan')}
                        >
                            <AppstoreOutlined/>
                            <span>{t.product}</span>
                        </button>
                        <button
                            type="button"
                            className={`m-dock-slot ${activeTab === 'orders' ? 'on' : ''}`}
                            onClick={() => setActiveTab('orders')}
                        >
                            <UnorderedListOutlined/>
                            <span>{t.orders}</span>
                        </button>
                        <button
                            type="button"
                            className="m-dock-orb"
                            aria-label={t.scan}
                            onClick={handleOpenScanner}
                        >
                            <QrcodeOutlined/>
                        </button>
                        {catalogEnabled && (
                            <button
                                type="button"
                                className="m-dock-slot"
                                onClick={handleOpenSearch}
                            >
                                <SearchOutlined/>
                                <span>{t.search}</span>
                            </button>
                        )}
                        <button
                            type="button"
                            className={`m-dock-slot m-dock-cart ${cartView.opensDrawer ? 'active' : ''}`}
                            aria-label={t.activeOrder}
                            onClick={() => {
                                if (cartView.opensDrawer) {
                                    setOrderDrawerVisible(true);
                                } else {
                                    setCustomerModalOpen(true);
                                }
                            }}
                        >
                            <Badge count={cartView.badgeCount} size="small" offset={[2, -2]} color="#ff4d4f">
                                <ShoppingCartOutlined/>
                            </Badge>
                            <span className={cartView.totalLabel ? 'm-dock-total' : ''}>
                                {cartView.totalLabel || t.cart}
                            </span>
                        </button>
                    </div>
                )}
```

Notes:
- The `isDarkMode` inline styles on the old bar are intentionally NOT carried over — dark mode is handled by the `.dark-theme .m-dock*` CSS in Step 5.
- The cart tap branches on `cartView.opensDrawer`, not `activeOrder`, so a paused order (order mode off) opens the client modal exactly like today's gray FAB.
- All icons used here are already imported; do not remove any existing icon imports (`RightOutlined`, `ShoppingCartOutlined`, `Badge`, `Flex`, `Text` all have other call sites).

d) Retarget the fly-to-cart animation. In `animateAddToCart` (line 800), change:
```js
        const cartEl = document.querySelector('.m-cart-fab');
```
to:
```js
        const cartEl = document.querySelector('.m-dock-cart');
```

- [ ] **Step 4: Remove the old CSS**

In `barcode-scanner-frontend/src/index.css`:

a) Delete the `.m-bottom-bar` rule (lines 178–190) and the action/tab rules `.m-action-row`, `.m-fab-scan`, `.m-fab-search`, `.m-tab-bar`, `.m-tab-item`, `.m-tab-item .anticon`, `.m-tab-item .ant-badge`, `.m-tab-active`, `.m-tab-item:active` (lines 197–274). **Keep** the `@keyframes fabSlideUp` block (lines 192–195) — the dock reuses it.

b) In the `@media (min-width: 1024px)` block (lines 1328–1341), delete the `.m-bottom-bar` override (lines 1333–1340). Keep the `.m-dashboard` override.

c) Delete the dark-theme overrides for the removed classes (lines 1344–1355):
```css
.dark-theme .m-bottom-bar { ... }
.dark-theme .m-tab-item { ... }
.dark-theme .m-tab-active { ... }
```

d) Delete the `.m-cart-fab` rules (lines 1682–1718): `.m-cart-fab`, `.m-cart-fab:active`, `.m-cart-fab.m-cart-fab--inactive`, `.m-cart-fab .anticon`. **Keep** `@keyframes m-cart-pulse` (lines 1720–1725) and the `.m-cart-fly` rules (lines 1733–1751). Change the pulse hook (line 1727–1729) from:
```css
.m-cart-fab.m-cart-pulse {
  animation: m-cart-pulse 0.45s ease-out;
}
```
to:
```css
.m-dock-cart.m-cart-pulse {
  animation: m-cart-pulse 0.45s ease-out;
}
```

e) Also remove the now-orphaned `.m-order-indicator` styles: search `index.css` for `m-order-indicator` and delete every matching rule (`.m-order-indicator`, `.m-order-indicator-text`, `.m-order-indicator-total`, any dark-theme variants).

- [ ] **Step 5: Add the dock CSS**

In `index.css`, where the deleted `.m-bottom-bar` block was (after `@keyframes fabSlideUp`), add:

```css
/* ===== Floating glass dock (tabs + scan + search + cart) ===== */
.m-dock {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  height: 72px;
  z-index: 1000;
  border-radius: 36px;
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(22px) saturate(180%);
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 10px 32px rgba(28, 36, 48, 0.18), 0 2px 8px rgba(28, 36, 48, 0.08);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 18px;
  animation: fabSlideUp 0.3s ease-out;
}

.m-dock-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 52px;
  min-height: 48px;
  padding: 0 4px;
  border: none;
  background: none;
  border-radius: 12px;
  cursor: pointer;
  color: rgba(0, 0, 0, 0.4);
  font-size: 10px;
  font-weight: 500;
  transition: color 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.m-dock-slot .anticon {
  font-size: 21px;
  color: inherit;
}

.m-dock-slot .ant-badge {
  color: inherit;
}

.m-dock-slot.on {
  color: #1677ff;
  font-weight: 600;
}

/* Cart slot brightens while an order is active */
.m-dock-cart.active {
  color: rgba(0, 0, 0, 0.65);
}

.m-dock-total {
  color: #1677ff;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.m-dock-orb {
  flex: none;
  width: 62px;
  height: 62px;
  border-radius: 50%;
  border: 4px solid rgba(255, 255, 255, 0.95);
  background: #1677ff;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 20px rgba(22, 119, 255, 0.4);
  margin-top: -26px;
  cursor: pointer;
  transition: transform 0.12s ease;
  -webkit-tap-highlight-color: transparent;
}

.m-dock-orb .anticon {
  font-size: 26px;
}

.m-dock-orb:active {
  transform: scale(0.95);
}
```

In the `@media (min-width: 1024px)` block (where the `.m-bottom-bar` override was deleted), add:

```css
  .m-dock {
    width: 776px;
    left: calc(50% - 388px);
    right: auto;
  }
```
(Fixed width + computed left centers the dock without a `transform`, which would fight the `fabSlideUp` transform animation.)

Where the dark-theme `.m-bottom-bar`/`.m-tab-item` overrides were deleted (line ~1344), add:

```css
.dark-theme .m-dock {
  background: rgba(28, 28, 30, 0.75);
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.3);
}

.dark-theme .m-dock-slot {
  color: rgba(255, 255, 255, 0.45);
}

.dark-theme .m-dock-slot.on {
  color: #4096ff;
}

.dark-theme .m-dock-cart.active {
  color: rgba(255, 255, 255, 0.75);
}

.dark-theme .m-dock-total {
  color: #4096ff;
}

.dark-theme .m-dock-orb {
  border-color: rgba(255, 255, 255, 0.2);
}
```

- [ ] **Step 6: Adjust content clearance**

In `index.css`, change `.m-dashboard-body` (line 159–164):
```css
.m-dashboard-body {
  flex: 1;
  padding-bottom: 140px; /* space for bottom bar */
  ...
}
```
to:
```css
.m-dashboard-body {
  flex: 1;
  padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px)); /* clear the floating dock */
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
```

- [ ] **Step 7: Build and run the full frontend test suite**

Run (from `barcode-scanner-frontend/`):
```bash
npm run build
```
Expected: compiles with no new warnings about undefined variables/unused imports introduced by this change (pre-existing warnings for `ShoppingOutlined`/`InboxOutlined` are not ours — leave them).

```bash
npm test -- --watchAll=false
```
Expected: all suites pass, including `dockCartView.test.js` from Task 1.

- [ ] **Step 8: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js barcode-scanner-frontend/src/index.css barcode-scanner-frontend/src/i18n/translations.js
git commit -m "feat(frontend): floating glass dock replaces bottom bar and cart FAB"
```

---

### Task 3: Browser verification and spec close-out

**Files:**
- Modify: `docs/superpowers/specs/2026-08-14-consultant-floating-dock-design.md` (status line)

**Interfaces:**
- Consumes: the rendered dock from Task 2 (classes `m-dock`, `m-dock-orb`, `m-dock-cart`).
- Produces: screenshots as proof; spec marked implemented.

- [ ] **Step 1: Start the dev stack**

Use the browser-verify recipe from project memory: mock-1C + Django `runserver` on :8000 + the frontend dev server via `preview_start` with `.claude/launch.json`, logging in as the gift-tester consultant user. (If port 8000 is squatted by a stale `--noreload` runserver, pick a fresh port per memory.)

- [ ] **Step 2: Verify the dock, idle state**

With no active order, on the Product tab, confirm via `read_page`/screenshot:
- The dock renders detached (12 px inset), five slots visible: პროდუქტი, შეკვეთები, orb, ძებნა, კალათა.
- The cart slot shows the "კალათა" label, no badge.
- The old bottom bar, cart bubble, and top blue order strip are gone.

Note: per project memory, Browser-pane clicks cannot reach the bottom nav — drive taps with `javascript_tool` `el.click()`.

- [ ] **Step 3: Verify the active-order state**

Start an order (cart slot tap with no order must open the client-lookup modal), pick/create a client, scan or search-add an item, then confirm:
- Cart slot shows the red item-count badge and the running total (e.g. `129.00₾`) in blue.
- Tapping the cart slot opens the order drawer.
- Adding an item plays the fly animation landing on the dock's cart slot, followed by the pulse.
- The scan tab no longer shows the top order-indicator strip; the OfflineBanner block is untouched.

- [ ] **Step 4: Verify tabs, search, and dark mode**

- Product/Orders slots switch tabs and take the blue active state.
- The orb opens the scanner; the ძებნა slot opens the find-product drawer; the dock hides while either overlay is open.
- Toggle the app's dark theme: dock flips to the dark glass material, active accents go `#4096ff`.
- Screenshot light + dark and send both to the user.

- [ ] **Step 5: Mark the spec implemented and commit**

Add under the mockup line at the top of `docs/superpowers/specs/2026-08-14-consultant-floating-dock-design.md`:
```markdown
**Status:** Implemented (2026-08-14).
```

```bash
git add docs/superpowers/specs/2026-08-14-consultant-floating-dock-design.md
git commit -m "docs: mark floating dock spec implemented"
```

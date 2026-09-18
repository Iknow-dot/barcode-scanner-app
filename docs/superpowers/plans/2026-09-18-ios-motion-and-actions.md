# iOS motion and native actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the toggles iOS's spring motion, and replace every antd confirmation popover and dropdown in the consultant app with native iOS behaviour — instant destructive actions and bottom action sheets.

**Architecture:** One new `IosActionSheet` primitive on the existing `IosSheet`, one shared motion token set in `theme/ios.css`, then three screens drop their antd `Popconfirm` / `Modal.confirm` / `Dropdown`.

**Tech Stack:** React 18 (CRA), antd 6, Jest + React Testing Library, the `--if-*` tokens and `ios.css` primitives.

**Decisions (from the user, 2026-09-18):**
- **Instant delete everywhere, no confirmation.** The swipe (or the action sheet's own red row) is the deliberate gesture. Deleting an order is a server-side delete with no undo — that is understood and accepted.
- The `⋯` order menu becomes an action sheet; the confirm-order popover goes away entirely; the order-confirmed dialog becomes a sheet; the cart price editor is restyled onto the app's own field primitives.

## Global Constraints

- All paths under `barcode-scanner-frontend/`. Test command from that
  directory: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`.
  Baseline: 79 suites / 716 tests passing.
- Never modify `addFlow.js`, `clientCreateRecovery.js`, `catalogBrowse.js`,
  `categoryTileStyle.js`, `orderStatusColor.js` or their tests.
- No literal colours; strings via `t` in both `ka` and `en`, each key exactly
  once per locale — grep before adding.
- **Motion must respect `prefers-reduced-motion`**: every animation added here
  collapses to no movement under that query. A consultant who has asked their
  phone for less motion gets less motion.
- Removing a confirmation removes its strings' only consumer. Grep each
  (`confirmDelete`, `confirmDeleteOrder`, `confirmProceedToPayment`, `yes`,
  `no`) before deleting — several are shared.
- Commit per task, `git add` by path only (shared checkout), never push.
  Trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

### Task 1: The motion tokens and the action sheet

**Files:**
- Modify: `src/theme/ios.css`
- Create: `src/components/Common/IosActionSheet.js`, `IosActionSheet.test.js`
- Modify: `src/theme/iosCss.test.js`
- Modify: `src/i18n/translations.js`

**Interfaces:**
- Produces: `IosActionSheet({open, onClose, title, actions, cancelLabel})` where
  `actions` is `[{key, label, icon?, destructive?, onSelect}]`. Renders on
  `IosSheet` (so it inherits the portal, mask, Escape and focus trap), with a
  separate Cancel row beneath, as iOS does.
- Produces CSS: `--if-spring` (the timing function) and `.if-seg`'s thumb
  motion.

- [ ] **Step 1: Add the motion.** iOS's toggle motion overshoots slightly and
settles — a spring, not an ease. Add one shared timing function and apply it to
the segmented control's thumb and selected label, the switch, and the pill
toggle:

```css
/* iOS's toggles overshoot a little and settle rather than easing linearly to
   a stop. One curve, shared, so every toggle in the app moves the same way. */
:root {
    --if-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
    --if-spring-fast: 260ms;
}

.if-seg.ant-segmented .ant-segmented-thumb,
.if-seg.ant-segmented .ant-segmented-item-selected {
    transition: transform var(--if-spring-fast) var(--if-spring),
                background-color var(--if-spring-fast) ease,
                color 160ms ease;
}

@media (prefers-reduced-motion: reduce) {
    .if-seg.ant-segmented .ant-segmented-thumb,
    .if-seg.ant-segmented .ant-segmented-item-selected {
        transition: none;
    }
}
```

Check antd 6's actual thumb class names in `node_modules/antd/es/segmented/`
before committing to the selectors above — if they differ, use the real ones
and say so in the report.

- [ ] **Step 2: Write the failing action-sheet tests.** Renders each action's
label; a destructive action carries the destructive class and is announced as
such; selecting an action calls its `onSelect` and closes the sheet; Cancel
closes without calling anything; `open={false}` renders nothing.

- [ ] **Step 3: Implement `IosActionSheet`** on `IosSheet`. Rows are 44 px
minimum, the destructive one uses `--if-red-text`, and Cancel is visually
separated (its own group) the way iOS separates it.

- [ ] **Step 4: Extend `iosCss.test.js`** to assert `--if-spring` exists and
that the reduced-motion block disables the transition.

- [ ] **Step 5: Suite green, then commit**

```bash
git add src/theme/ios.css src/theme/iosCss.test.js src/components/Common/IosActionSheet.js src/components/Common/IosActionSheet.test.js src/i18n/translations.js
git commit -m "feat(motion): add the iOS spring curve and an action-sheet primitive"
```

---

### Task 2: Native actions on the order sheet, the orders list and the confirmed dialog

**Files:**
- Modify: `src/components/UserDashboard/OrderSheet.js` + its test
- Modify: `src/components/UserDashboard/OrdersView.js` + its test
- Modify: `src/components/UserDashboard/UserDashboard.js`

**Interfaces:**
- Consumes: `IosActionSheet` from Task 1.

- [ ] **Step 1: The `⋯` menu becomes an action sheet.** `OrderSheet.js:140-143`
currently builds an antd `Dropdown` menu (Save for later / Change customer /
Delete order). Move those into `IosActionSheet`, Delete last and destructive.

- [ ] **Step 2: Delete becomes instant.** Remove `modal.confirm` from
`OrderSheet.js:129` — selecting Delete in the action sheet calls `onDeleteOrder`
directly. Remove the `Popconfirm` from `OrdersView.js:174` — the swipe already
revealed the red action, so tapping it deletes. Keep the red styling and the
`aria-label`; keep the row's `stopPropagation` so deleting never also opens the
order.

- [ ] **Step 3: The confirm-order popover goes.** `OrderSheet.js:183`'s
`Popconfirm` wraps the primary confirm button; drop it and call the handler
directly. **Keep every existing guard** — `disabled={!hasItems || confirmDisabled}`,
the in-flight guard, and the flush-pending-edits-before-confirm behaviour the
phase 3 review added. Removing the popover must not remove the flush.

- [ ] **Step 4: The order-confirmed dialog becomes a sheet.**
`UserDashboard.js:620`'s `Modal.confirm` (success + Print / Done) becomes a
sheet in the app's own style. It is not a confirmation — it is a result with a
follow-up action, so it keeps both choices.

- [ ] **Step 5: Update the tests.** Each affected test that drove a Popconfirm's
"Yes" must now assert the action fires on the first tap. Add one test per
screen proving no confirmation step remains (no `Yes`/`No` in the document
after tapping delete).

- [ ] **Step 6: Suite green, then commit**

```bash
git add src/components/UserDashboard/OrderSheet.js src/components/UserDashboard/OrderSheet.test.js src/components/UserDashboard/OrdersView.js src/components/UserDashboard/OrdersView.test.js src/components/UserDashboard/UserDashboard.js
git commit -m "feat(actions): instant deletes, an action-sheet order menu and a result sheet"
```

---

### Task 3: The cart line

**Files:**
- Modify: `src/components/UserDashboard/CartItemRow.js` + its test
- Modify: `src/index.css` (the cart price editor's rules)

**Interfaces:**
- Consumes: nothing from Task 1 (the cart line's delete is instant, not a sheet).

- [ ] **Step 1: Delete becomes instant.** Remove the `Popconfirm` at
`CartItemRow.js:210`. The trash still appears only at `totalQty === 1` (the
rule the phase 3 review settled), still respects the per-row busy guard, and
still removes both the paid and gift lines together.

- [ ] **Step 2: Restyle the price and discount editor.** It already expands
inline (no popup) — replace antd's `InputNumber` chrome with the app's own
field primitives (`.if-field-label` / `.if-field-input`), keeping the
`canApplyDiscount` gate, the patch shape `pricePatch(next)` and the existing
validation exactly as they are.

- [ ] **Step 3: Update the tests**, including one asserting a single tap
deletes with no confirmation step.

- [ ] **Step 4: Suite green, then commit**

```bash
git add src/components/UserDashboard/CartItemRow.js src/components/UserDashboard/CartItemRow.test.js src/index.css
git commit -m "feat(cart): delete a line in one tap and restyle its price editor"
```

# Order Panel — Two-Step Flow

## Problem

The mobile order drawer (`OrderPanel.js`) currently renders one long screen: items list → total → delivery section → order-notes → Proceed-to-Payment. Users have to scroll past delivery options to confirm items, and the page mixes two distinct intents (what is being bought vs. how/where it's delivered) into a single dense view.

## Goal

Split the order drawer into two sequential steps inside the same mobile drawer:

- **Step 1 — Products:** items list + order total.
- **Step 2 — Delivery:** delivery section (pickup/delivery + address/date/time/delivery-notes) + order-notes.

`Proceed to Payment` lives at the end of step 2.

## Non-goals

- No backend changes. Field-level autosave already persists every change as it happens.
- No desktop layout work. `OrderPanel` is rendered only inside the mobile order drawer (`UserDashboard.js`); there is no separate desktop view.
- No refactor splitting `OrderPanel.js` into multiple files. The existing memoized sub-components (`OrderItemGroupCard`, `DeliverySection`, `NotesSection`) already separate concerns cleanly enough; this change only adds a `step` state around them.

## Design

### Layout

The drawer body is divided into three vertical regions:

1. **Top region (always visible)**
   - The existing customer-info bar (`UserOutlined` + `customer_name`).
   - A new Ant Design `Steps` indicator with two steps: `stepProducts`, `stepDelivery`. `current = step - 1`.
   - The existing `Save for later` + overflow menu stays in the top-right of the drawer (unchanged).

2. **Middle region (step-conditional)**
   - **Step 1:** the existing items-list block (`OrderItemGroupCard` mapped over `groups`) followed by the order-total bar. The `Empty` state (when `!hasItems`) renders here.
   - **Step 2:** the existing `DeliverySection` + `NotesSection`, in that order.

3. **Bottom region (action bar)**
   - **Step 1:** a single full-width `Next →` button. `disabled` when `!hasItems`.
   - **Step 2:** a 2-button row — `← Back` (left) and the existing `Proceed to payment` Popconfirm (right, primary). `Proceed to payment` keeps its existing `disabled={!hasItems}` rule.

### State

A single new piece of local state in `OrderPanel`:

```js
const [step, setStep] = useState(1); // 1 = products, 2 = delivery
```

### Navigation

- `Next →` (step 1) → `setStep(2)`.
- `← Back` (step 2) → `setStep(1)`.
- Tapping the `Steps` indicator: step 1 is always enabled; step 2 is `disabled` when `!hasItems` (mirrors the button rule).
- All field changes on either step continue to autosave through the existing `handleLocalOrderUpdate` path. Navigating between steps never loses or batches data.

### Reset to step 1 on drawer reopen

The order drawer in `UserDashboard.js` (the `<Drawer>` around line 972 with `className="m-order-drawer"`) does NOT have `destroyOnHidden`, so `OrderPanel` stays mounted across close/open cycles. We need an explicit reset.

Approach: add `destroyOnHidden` to the order drawer. The neighbouring search drawer already uses this prop (line 877 of `UserDashboard.js`), so the pattern is established. With `destroyOnHidden` set, `OrderPanel` unmounts on close and remounts on reopen — `useState(1)` then correctly puts every reopen at step 1. We additionally reset `step` to 1 in the existing id-change branch of the sync effect inside `OrderPanel`, to cover the case where `initialOrder.id` changes without an unmount (rare but possible — e.g., switching active orders without closing the drawer).

### Edge cases

- **Cart emptied on step 2:** `Proceed to payment` becomes disabled (existing rule). The user can tap `← Back` or the step-1 indicator to return.
- **Items added externally while on step 2:** the existing item-count sync effect updates `localOrder`. `step` stays at 2 — the user keeps their delivery context. They can navigate back to verify items.
- **`isMobileDrawer={false}` rendering:** `OrderPanel` is currently only mounted via the drawer (`isMobileDrawer={true}`). The two-step behavior applies in both modes — no `isMobileDrawer` branching for step state.

### i18n

Four new keys in `barcode-scanner-frontend/src/i18n/en.js` and `ka.js`:

| Key | English | Georgian |
|---|---|---|
| `stepProducts` | Products | პროდუქტები |
| `stepDelivery` | Delivery | მიწოდება |
| `nextStep` | Next | შემდეგი |
| `backStep` | Back | უკან |

Existing `proceedToPayment`, `confirmProceedToPayment`, `saveForLater`, `deleteOrder` keys are reused unchanged.

## Files affected

- `barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js` — add `step` state, `Steps` indicator, conditional middle region, swapped action bar, reset-step in the id-change branch of the sync effect.
- `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js` — add `destroyOnHidden` prop to the order `<Drawer>`.
- `barcode-scanner-frontend/src/i18n/en.js` — add 4 keys.
- `barcode-scanner-frontend/src/i18n/ka.js` — add 4 keys.

No backend, no migrations, no API changes.

## Testing

- **Existing tests:** `groupItemsBySku.test.js` continues to pass unchanged.
- **No new automated tests:** the change is purely UI state. Sub-component logic (item editing, discount, delivery field saves) is untouched.
- **Manual verification:** start with an active order; verify step 1 shows items + total + Next; "Next" disabled when cart empty; step 2 shows delivery + notes; field changes persist; "Back" returns to step 1; close+reopen drawer lands on step 1; Proceed-to-Payment Popconfirm fires from step 2 only.

## Risks

Low. The change is additive UI state inside one component. Field-level autosave is already proven and unchanged. Rollback is a single-file revert.

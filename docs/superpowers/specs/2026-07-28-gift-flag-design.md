# Gift button/flag on order items — Design

- **ClickUp task:** [86ca495uu — საჩუქრის ღილაკი/ალამი პროდუქტებებში](https://app.clickup.com/t/86ca495uu) (Release 2.1 - MVP, high)
- **Related:** [86canr5rf — IFlow-ს მხარე](https://app.clickup.com/t/86canr5rf), subtask of the 1C-side
  [86cakz72m — შეკვეთის შექმნის ვებსერვისში საჩუქრის გათვალისწინება](https://app.clickup.com/t/86cakz72m) (1C side in review)
- **Date:** 2026-07-28
- **Status:** Approved design, ready for implementation planning

## Goal

A consultant can mark any order line ("position") as a **gift** on the order's products tab.
The mark is purely informational: the line price, line total, and order total are unchanged.
The feature is configurable per organization because most orgs will not use it.

## Scope decision

The app does not yet call 1C's CreateOrder web service at all (that service exists and is done
on the 1C side — task 86c986c4r — but no integration exists in this codebase). **This task ships
the flag end-to-end inside the app only.** When the CreateOrder integration is built as its own
task, `is_gift` is already on each item row and rides along in the payload; that integration task
is what ultimately closes 86canr5rf.

## Rejected approaches

- **Gift as a zero-price / 100%-discount line** — contradicts the task: price and totals must
  stay unchanged.
- **Per-user privilege (like `can_apply_discount`)** — the task explicitly asks for org-level
  configurability ("ორგანიზაციის ჭრილში").

## Data model

Two additive migrations:

- `Organization.gift_marking_enabled` — `BooleanField(default=False)`. Edited on the
  organization form (system admin dashboard). Off ⇒ the feature is invisible for that org.
- `PurchaseOrderItem.is_gift` — `BooleanField(default=False)`. `effective_price` /
  `line_total` / `PurchaseOrder.total` ignore it entirely.

## Backend API

- Organization serializers expose `gift_marking_enabled`, writable wherever org fields are
  editable today.
- Order item serializers include `is_gift`. `add_item`, `update_item`, and the bulk-update
  path accept it.
- **Server-side guard** (mirrors the discount-privilege pattern in `core/views.py`): any
  request that sets `is_gift=true` while the order's organization has
  `gift_marking_enabled=False` is rejected with
  `403 {"code": "GIFT_NOT_ENABLED", "detail": ...}`. Clearing the flag (`false`) is always
  allowed. Two-layer rule: the UI hides the control, the backend enforces it.
- Login payload (`CustomTokenObtainPairSerializer`) additionally carries
  `gift_marking_enabled` (additive key — existing frontend api shape stays compatible).

## Frontend

- **Cart line rows** (`CartTableRow` in `OrderPanel.js`): a gift icon button (`GiftOutlined`)
  per row; tap toggles `is_gift` through the existing `updateOrderItem` service call, so the
  offline queue replays it with no extra work. Active state renders a small "საჩუქარი" tag on
  the row. The control is hidden entirely when the org flag is off.
- **Admin orders view** (`OrdersTab` item rows): gifted lines show a gift tag.
- **Organization form**: a switch for `gift_marking_enabled` with hint text.
- **i18n**: Georgian + English strings for the toggle, tag, hint, and the `GIFT_NOT_ENABLED`
  error code.

## Out of scope

- Invoice rendering of gift marks (not requested).
- The CreateOrder 1C push (separate future task; see Scope decision).
- `AddToCartSheet` (the task specifies the order's products tab).

## Testing

- **Backend:** model defaults; `is_gift` round-trip via add/update/bulk endpoints when the org
  flag is on; `GIFT_NOT_ENABLED` rejection when off; clearing allowed regardless; line/order
  totals unaffected by `is_gift`.
- **Frontend:** gift control hidden when org flag off / shown when on; toggling fires
  `updateOrderItem` with the right payload; gifted row renders the tag.

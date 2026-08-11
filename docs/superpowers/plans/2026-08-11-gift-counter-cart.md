# B1 Inline Gift Counter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let consultants mark part of a cart line as a gift (e.g. 1 of 3 units) with a touch-sized pill + mini-stepper, persisting the split as two order lines (paid + `is_gift`).

**Architecture:** One-line backend change makes `add_item`'s same-SKU merge respect `is_gift`, so a gift line can coexist with a paid line for the same SKU + warehouse. The frontend pairs those two lines back into a single visual row (`pairGiftLines`), and a pure planner (`planGiftChange`) translates a target gift count into a sequence of existing add/update/remove item API calls — increase-side first so a mid-sequence failure leaves visible surplus, never lost units. A new `GiftCounter` component (pill + magenta mini-stepper, 44px touch targets on mobile) replaces `GiftToggleButton`.

**Tech Stack:** Django 6 + DRF (backend/core), React 18 + Ant Design 6 (CRA), Jest + @testing-library/react.

## Global Constraints

- Do NOT commit without the user's explicit go-ahead (harness rule overrides the usual commit-per-task cadence; keep the working tree clean and reviewable instead).
- Backend scope is exactly the `add_item` merge filter + its tests — nothing else in `backend/` may change.
- Error responses keep the `{"code": ..., "detail": ...}` envelope; no new error codes are needed.
- The `device_id` localStorage key must never be touched by any auth cleanup (unrelated, standing rule).
- Frontend touch sizing (44px) applies in the stacked mobile layout (`max-width: 599px`); the ≥600px desktop table keeps current control sizes but gains the same gift pill and row tinting.
- Georgian label for gift comes from the existing `t.giftLabel` key (`საჩუქარი` / `Gift`); no new translation keys.
- Run backend tests with `uv --directory backend run python manage.py test core.tests.GiftFlagEndpointTests` (bare `python` is the wrong global Django).
- Run frontend tests from `barcode-scanner-frontend/` with `npm test -- --watchAll=false --testPathPattern=<pattern>`.

---

### Task 1: Backend — is_gift-aware merge in add_item

**Files:**
- Modify: `backend/core/views.py:1377-1402` (the `add_item` merge block)
- Test: `backend/core/tests.py` (extend `GiftFlagEndpointTests`, which ends at line ~5317)

**Interfaces:**
- Consumes: existing `GiftFlagEndpointTests` fixtures — `self.item` is SKU1/WHA, qty 2, paid.
- Produces: `POST /api/v1/orders/{id}/items/` with `is_gift: true` creates a line that never merges into a paid line of the same SKU + warehouse (and vice versa). Frontend Task 3 relies on this exact behavior.

- [ ] **Step 1: Write the failing tests** — append to `GiftFlagEndpointTests` in `backend/core/tests.py`:

```python
    def test_add_gift_line_does_not_merge_into_paid_line(self):
        response = self.client.post(
            f'/api/v1/orders/{self.order.id}/items/',
            {'sku': 'SKU1', 'price': '100.00', 'quantity': 1,
             'warehouse_code': 'WHA', 'is_gift': True},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        lines = self.order.items.filter(sku='SKU1', warehouse_code='WHA')
        self.assertEqual(lines.count(), 2)
        self.item.refresh_from_db()
        self.assertFalse(self.item.is_gift)
        self.assertEqual(self.item.quantity, 2)
        gift_line = lines.get(is_gift=True)
        self.assertEqual(gift_line.quantity, 1)

    def test_add_paid_line_still_merges_into_paid_line(self):
        response = self.client.post(
            f'/api/v1/orders/{self.order.id}/items/',
            {'sku': 'SKU1', 'price': '100.00', 'quantity': 1,
             'warehouse_code': 'WHA'},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        lines = self.order.items.filter(sku='SKU1', warehouse_code='WHA')
        self.assertEqual(lines.count(), 1)
        self.item.refresh_from_db()
        self.assertEqual(self.item.quantity, 3)

    def test_add_gift_line_merges_into_existing_gift_line(self):
        PurchaseOrderItem.objects.create(
            order=self.order, sku='SKU1', sku_name='Widget',
            price='100.00', quantity=1, warehouse_code='WHA',
            warehouse_name='WH-A', is_gift=True,
        )
        response = self.client.post(
            f'/api/v1/orders/{self.order.id}/items/',
            {'sku': 'SKU1', 'price': '100.00', 'quantity': 1,
             'warehouse_code': 'WHA', 'is_gift': True},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        lines = self.order.items.filter(sku='SKU1', warehouse_code='WHA')
        self.assertEqual(lines.count(), 2)
        gift_line = lines.get(is_gift=True)
        self.assertEqual(gift_line.quantity, 2)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv --directory backend run python manage.py test core.tests.GiftFlagEndpointTests -v 2`
Expected: `test_add_gift_line_does_not_merge_into_paid_line` FAILS (merge produced 1 line, qty 3, is_gift True); `test_add_gift_line_merges_into_existing_gift_line` FAILS (merged into the paid line, not the gift line). The `still_merges` test passes already (guards the regression).

- [ ] **Step 3: Implement** — in `backend/core/views.py` `add_item`, make the merge filter is_gift-aware and drop the now-dead gift flip:

```python
        # Check if the same SKU + warehouse (+ gift class) already exists —
        # if so, increment quantity. Gift lines never merge with paid lines:
        # a partial gift is represented as two separate lines.
        filter_kwargs = {'sku': data['sku'], 'is_gift': data.get('is_gift', False)}
        if data.get('warehouse_code'):
            filter_kwargs['warehouse_code'] = data['warehouse_code']
        existing_item = order.items.filter(**filter_kwargs).first()
```

and remove these two lines from the merge branch (both sides of the merge now share the same `is_gift` value, so the flip is dead code):

```python
            if data.get('is_gift'):
                existing_item.is_gift = True
```

- [ ] **Step 4: Run the full gift test class**

Run: `uv --directory backend run python manage.py test core.tests.GiftFlagEndpointTests -v 2`
Expected: all PASS (including the three pre-existing add_item/bulk tests).

- [ ] **Step 5: Regression sweep of the order endpoints**

Run: `uv --directory backend run python manage.py test core -v 1`
Expected: PASS. (No commit — see Global Constraints.)

---

### Task 2: Frontend — pairGiftLines + planGiftChange (pure logic, TDD)

**Files:**
- Create: `barcode-scanner-frontend/src/components/UserDashboard/giftSplit.js`
- Test: `barcode-scanner-frontend/src/components/UserDashboard/giftSplit.test.js`

**Interfaces:**
- Consumes: raw `PurchaseOrderItem` objects as the API returns them (`id`, `sku`, `sku_name`, `article`, `price`, `quantity`, `warehouse_code`, `warehouse_name`, `unit`, `is_gift`, …).
- Produces:
  - `pairGiftLines(items) -> [{key, warehouse_code, warehouse_name, paid, gift, totalQty, giftQty}]` — one entry per warehouse, `paid`/`gift` are the raw items or `null`.
  - `planGiftChange(row, targetGift) -> [{op: 'update', itemId, data} | {op: 'add', data} | {op: 'remove', itemId}]` — ordered ops; increase-side first.
  - `applyGiftOps(orderId, ops) -> Promise<{success, data?, error?}>` — sequential executor over `orderService`; last successful response is canonical.

- [ ] **Step 1: Write the failing tests** — `giftSplit.test.js`:

```javascript
import {pairGiftLines, planGiftChange} from './giftSplit';

const paid = (over = {}) => ({
    id: 1, sku: 'S1', sku_name: 'Widget', article: 'A1', price: '10.00',
    quantity: 3, warehouse_code: 'WHA', warehouse_name: 'WH-A', unit: 'piece',
    is_gift: false, ...over,
});
const gift = (over = {}) => paid({id: 2, quantity: 1, is_gift: true, ...over});

describe('pairGiftLines', () => {
    it('pairs a paid and gift line of the same warehouse into one row', () => {
        const rows = pairGiftLines([paid(), gift()]);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            warehouse_code: 'WHA', totalQty: 4, giftQty: 1,
        });
        expect(rows[0].paid.id).toBe(1);
        expect(rows[0].gift.id).toBe(2);
    });

    it('keeps different warehouses as separate rows in insertion order', () => {
        const rows = pairGiftLines([
            paid(), paid({id: 3, warehouse_code: 'WHB', warehouse_name: 'WH-B'}),
        ]);
        expect(rows.map((r) => r.warehouse_code)).toEqual(['WHA', 'WHB']);
        expect(rows[0].giftQty).toBe(0);
        expect(rows[0].gift).toBeNull();
    });

    it('handles a gift-only line', () => {
        const rows = pairGiftLines([gift({quantity: 2})]);
        expect(rows[0]).toMatchObject({totalQty: 2, giftQty: 2});
        expect(rows[0].paid).toBeNull();
    });

    it('gives duplicate same-class lines their own standalone rows', () => {
        // Bulk admin edits can produce two gift lines for one warehouse;
        // the second must not silently shadow the first in the pairing.
        const rows = pairGiftLines([paid(), gift(), gift({id: 9, quantity: 4})]);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({totalQty: 4, giftQty: 1});
        expect(rows[1]).toMatchObject({totalQty: 4, giftQty: 4});
        expect(rows[1].paid).toBeNull();
        expect(rows[1].gift.id).toBe(9);
    });
});

describe('planGiftChange', () => {
    const row = (p, g) => {
        const items = [];
        if (p) items.push(paid({quantity: p}));
        if (g) items.push(gift({quantity: g}));
        return pairGiftLines(items)[0];
    };

    it('returns no ops when the target equals the current gift count', () => {
        expect(planGiftChange(row(2, 1), 1)).toEqual([]);
    });

    it('clamps the target into [0, totalQty]', () => {
        expect(planGiftChange(row(2, 1), 99)).toEqual(planGiftChange(row(2, 1), 3));
        expect(planGiftChange(row(2, 1), -4)).toEqual(planGiftChange(row(2, 1), 0));
    });

    it('first gift on a multi-unit paid line: add gift line first, then shrink paid', () => {
        const ops = planGiftChange(row(3, 0), 1);
        expect(ops).toEqual([
            {op: 'add', data: {
                sku: 'S1', sku_name: 'Widget', article: 'A1', price: '10.00',
                quantity: 1, warehouse_code: 'WHA', warehouse_name: 'WH-A',
                unit: 'piece', is_gift: true,
            }},
            {op: 'update', itemId: 1, data: {quantity: 2}},
        ]);
    });

    it('whole single-unit line becomes a gift with a flag flip, no split', () => {
        expect(planGiftChange(row(1, 0), 1)).toEqual([
            {op: 'update', itemId: 1, data: {is_gift: true}},
        ]);
    });

    it('whole multi-unit line becomes a gift with a flag flip when no gift line exists', () => {
        expect(planGiftChange(row(3, 0), 3)).toEqual([
            {op: 'update', itemId: 1, data: {is_gift: true}},
        ]);
    });

    it('growing the gift side updates gift before paid', () => {
        expect(planGiftChange(row(2, 1), 2)).toEqual([
            {op: 'update', itemId: 2, data: {quantity: 2}},
            {op: 'update', itemId: 1, data: {quantity: 1}},
        ]);
    });

    it('shrinking the gift side updates paid before gift', () => {
        expect(planGiftChange(row(1, 2), 1)).toEqual([
            {op: 'update', itemId: 1, data: {quantity: 2}},
            {op: 'update', itemId: 2, data: {quantity: 1}},
        ]);
    });

    it('absorbing the paid line: gift grows to total, paid removed', () => {
        expect(planGiftChange(row(2, 1), 3)).toEqual([
            {op: 'update', itemId: 2, data: {quantity: 3}},
            {op: 'remove', itemId: 1},
        ]);
    });

    it('clearing gifts with both lines: paid absorbs, gift removed', () => {
        expect(planGiftChange(row(2, 1), 0)).toEqual([
            {op: 'update', itemId: 1, data: {quantity: 3}},
            {op: 'remove', itemId: 2},
        ]);
    });

    it('clearing gifts on a gift-only row flips the flag back', () => {
        expect(planGiftChange(row(0, 2), 0)).toEqual([
            {op: 'update', itemId: 2, data: {is_gift: false}},
        ]);
    });

    it('partially un-gifting a gift-only row adds a paid line first', () => {
        expect(planGiftChange(row(0, 3), 1)).toEqual([
            {op: 'add', data: {
                sku: 'S1', sku_name: 'Widget', article: 'A1', price: '10.00',
                quantity: 2, warehouse_code: 'WHA', warehouse_name: 'WH-A',
                unit: 'piece', is_gift: false,
            }},
            {op: 'update', itemId: 2, data: {quantity: 1}},
        ]);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `barcode-scanner-frontend/`): `npm test -- --watchAll=false --testPathPattern=giftSplit`
Expected: FAIL — module `./giftSplit` not found.

- [ ] **Step 3: Implement `giftSplit.js`**

```javascript
/**
 * A "partial gift" is represented as two PurchaseOrderItem lines with the
 * same SKU + warehouse — one paid, one is_gift. This module pairs those
 * lines back into single visual rows and plans the API operations needed
 * to move units between the two lines.
 *
 * Op ordering rule: the growing side changes first, so a mid-sequence
 * failure leaves a visible surplus in the cart rather than silently
 * dropping units.
 */
import {orderService} from '../../api';

export const pairGiftLines = (items) => {
    const rows = [];
    const byCode = new Map(); // warehouse_code -> primary row (still pairable)
    for (const it of items) {
        const code = it.warehouse_code || '';
        const slot = it.is_gift ? 'gift' : 'paid';
        const existing = byCode.get(code);
        if (existing && existing[slot] === null) {
            existing[slot] = it;
            continue;
        }
        const row = {
            key: existing ? `line-${it.id}` : `wh-${code}`,
            warehouse_code: code,
            warehouse_name: it.warehouse_name,
            paid: null,
            gift: null,
        };
        row[slot] = it;
        rows.push(row);
        // Duplicate same-class lines (possible via bulk admin edits) get
        // standalone rows; only the first row per warehouse keeps pairing.
        if (!existing) byCode.set(code, row);
    }
    return rows.map((row) => {
        const paidQty = Number(row.paid?.quantity || 0);
        const giftQty = Number(row.gift?.quantity || 0);
        return {...row, totalQty: paidQty + giftQty, giftQty};
    });
};

// Fields copied onto the new line when a split creates one. Discounts are
// deliberately NOT copied — they stay on the paid line.
const copyLineFields = (item) => ({
    sku: item.sku,
    sku_name: item.sku_name,
    article: item.article,
    price: item.price,
    warehouse_code: item.warehouse_code,
    warehouse_name: item.warehouse_name,
    unit: item.unit,
});

export const planGiftChange = (row, targetGift) => {
    const {paid, gift, totalQty, giftQty} = row;
    const target = Math.max(0, Math.min(totalQty, targetGift));
    if (target === giftQty) return [];

    if (target === 0) {
        if (paid && gift) {
            return [
                {op: 'update', itemId: paid.id, data: {quantity: totalQty}},
                {op: 'remove', itemId: gift.id},
            ];
        }
        return [{op: 'update', itemId: gift.id, data: {is_gift: false}}];
    }

    if (target === totalQty) {
        if (paid && gift) {
            return [
                {op: 'update', itemId: gift.id, data: {quantity: totalQty}},
                {op: 'remove', itemId: paid.id},
            ];
        }
        return [{op: 'update', itemId: paid.id, data: {is_gift: true}}];
    }

    // 0 < target < totalQty — both sides will exist afterwards.
    if (paid && gift) {
        const giftOp = {op: 'update', itemId: gift.id, data: {quantity: target}};
        const paidOp = {op: 'update', itemId: paid.id, data: {quantity: totalQty - target}};
        return target > giftQty ? [giftOp, paidOp] : [paidOp, giftOp];
    }
    if (paid) {
        return [
            {op: 'add', data: {...copyLineFields(paid), quantity: target, is_gift: true}},
            {op: 'update', itemId: paid.id, data: {quantity: totalQty - target}},
        ];
    }
    return [
        {op: 'add', data: {...copyLineFields(gift), quantity: totalQty - target, is_gift: false}},
        {op: 'update', itemId: gift.id, data: {quantity: target}},
    ];
};

export const applyGiftOps = async (orderId, ops) => {
    let last = null;
    for (const step of ops) {
        let result;
        if (step.op === 'add') result = await orderService.addOrderItem(orderId, step.data);
        else if (step.op === 'update') result = await orderService.updateOrderItem(orderId, step.itemId, step.data);
        else result = await orderService.removeOrderItem(orderId, step.itemId);
        if (!result.success) return result;
        last = result;
    }
    return last ?? {success: true, data: null};
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --watchAll=false --testPathPattern=giftSplit`
Expected: PASS (the `applyGiftOps` import of `orderService` must not break jest — `../../api` is already imported by other tested modules).

---

### Task 3: Frontend — GiftCounter component (replaces GiftToggleButton)

**Files:**
- Create: `barcode-scanner-frontend/src/components/UserDashboard/GiftCounter.js`
- Test: `barcode-scanner-frontend/src/components/UserDashboard/GiftCounter.test.js`
- Delete: `barcode-scanner-frontend/src/components/UserDashboard/GiftToggleButton.js`, `GiftToggleButton.test.js` (in Task 4, after OrderPanel stops importing it)

**Interfaces:**
- Consumes: nothing project-specific beyond antd.
- Produces: `<GiftCounter enabled totalQty giftQty label onChange />` — `onChange(targetGift)` fires with the desired absolute gift count. Task 4 wires `onChange` to `planGiftChange`/`applyGiftOps`.

- [ ] **Step 1: Write the failing tests** — `GiftCounter.test.js`:

```javascript
import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import GiftCounter from './GiftCounter';

describe('GiftCounter', () => {
  it('renders nothing when the org has gifts disabled', () => {
    const {container} = render(
      <GiftCounter enabled={false} totalQty={3} giftQty={0} onChange={() => {}} label="Gift"/>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('idle pill requests one gift', () => {
    const onChange = jest.fn();
    render(<GiftCounter enabled totalQty={3} giftQty={0} onChange={onChange} label="Gift"/>);
    fireEvent.click(screen.getByRole('button', {name: 'Gift'}));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('active pill clears all gifts and shows the split', () => {
    const onChange = jest.fn();
    render(<GiftCounter enabled totalQty={3} giftQty={1} onChange={onChange} label="Gift"/>);
    const pill = screen.getByRole('button', {name: 'Gift'});
    expect(pill).toHaveTextContent('1/3');
    fireEvent.click(pill);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('mini stepper steps the gift count both ways', () => {
    const onChange = jest.fn();
    render(<GiftCounter enabled totalQty={3} giftQty={1} onChange={onChange} label="Gift"/>);
    fireEvent.click(screen.getByRole('button', {name: 'Gift +'}));
    expect(onChange).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole('button', {name: 'Gift −'}));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('cannot step past the line quantity', () => {
    render(<GiftCounter enabled totalQty={2} giftQty={2} onChange={() => {}} label="Gift"/>);
    expect(screen.getByRole('button', {name: 'Gift +'})).toBeDisabled();
  });

  it('hides the mini stepper when nothing is gifted', () => {
    render(<GiftCounter enabled totalQty={2} giftQty={0} onChange={() => {}} label="Gift"/>);
    expect(screen.queryByRole('button', {name: 'Gift +'})).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --watchAll=false --testPathPattern=GiftCounter`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `GiftCounter.js`**

```javascript
import React from 'react';
import {GiftOutlined} from '@ant-design/icons';

/**
 * Pill + mini-stepper for marking part of a cart row as a gift
 * (ClickUp 86ca495uu, B1 design). Rendered only when the org has gift
 * marking enabled; the backend independently enforces GIFT_NOT_ENABLED.
 *
 * onChange receives the desired ABSOLUTE gift count (0..totalQty); the
 * caller translates it into line splits via planGiftChange.
 */
const GiftCounter = ({enabled, totalQty, giftQty, onChange, label}) => {
    if (!enabled) return null;
    const state = giftQty === 0 ? 'idle' : (giftQty >= totalQty ? 'full' : 'partial');
    return (
        <div className="m-gift-line">
            <button
                type="button"
                className={`m-gift-pill m-gift-pill-${state}`}
                onClick={() => onChange(giftQty > 0 ? 0 : 1)}
                aria-label={label}
                title={label}
            >
                <GiftOutlined/>
                <span>{giftQty > 0 ? `${giftQty}/${totalQty} ${label}` : label}</span>
            </button>
            {giftQty > 0 && (
                <span className="m-gift-mini">
                    <button type="button" aria-label={`${label} −`}
                            onClick={() => onChange(giftQty - 1)}>−</button>
                    <span className="m-gift-mini-count">{giftQty} / {totalQty}</span>
                    <button type="button" aria-label={`${label} +`}
                            disabled={giftQty >= totalQty}
                            onClick={() => onChange(giftQty + 1)}>+</button>
                </span>
            )}
        </div>
    );
};

export default GiftCounter;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --watchAll=false --testPathPattern=GiftCounter`
Expected: PASS.

---

### Task 4: Frontend — wire paired rows into OrderPanel

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js` (CartTableRow ~100-312, OrderItemGroupCard ~316-522, total bar ~1041-1047)
- Delete: `GiftToggleButton.js`, `GiftToggleButton.test.js`

**Interfaces:**
- Consumes: `pairGiftLines`, `planGiftChange`, `applyGiftOps` (Task 2); `GiftCounter` (Task 3).
- Produces: CartTableRow now takes `row` (paired) instead of `item`. Everything else keeps its current props.

- [ ] **Step 1: Rework `CartTableRow`** — prop `item` becomes `row` (`{paid, gift, totalQty, giftQty, warehouse_code, warehouse_name, key}`). Inside:

```javascript
const CartTableRow = memo(({
    row, stockNumber, assigned, orderId, onLocalOrderUpdate, notify, t,
    canApplyDiscount, maxDiscountPercent, giftEnabled,
}) => {
    const [editingPrice, setEditingPrice] = useState(false);
    const [editingDiscount, setEditingDiscount] = useState(false);
    // The line that carries price/discount edits and quantity growth:
    // the paid line when it exists, otherwise the gift line.
    const anchor = row.paid ?? row.gift;

    const handleQuantityChange = useCallback(async (newTotal) => {
        if (newTotal < 1) return;
        // Keep the gift count; the paid side absorbs the difference. When
        // the row is gift-only, the gift line IS the row.
        const target = row.paid ?? row.gift;
        const otherQty = row.paid ? row.giftQty : 0;
        const newQty = newTotal - otherQty;
        if (newQty < 1) return; // shrink gifts via the gift stepper instead
        const result = await orderService.updateOrderItem(orderId, target.id, {quantity: newQty});
        if (result.success) onLocalOrderUpdate(result.data);
        else notify.error(t.orderError, result.error);
    }, [orderId, row, onLocalOrderUpdate, notify, t]);

    const handleGiftChange = useCallback(async (targetGift) => {
        const ops = planGiftChange(row, targetGift);
        if (ops.length === 0) return;
        const result = await applyGiftOps(orderId, ops);
        if (result.success) onLocalOrderUpdate(result.data);
        else notify.error(t.orderError, result.error);
    }, [orderId, row, onLocalOrderUpdate, notify, t]);

    const handleRemoveLine = useCallback(async () => {
        // Remove BOTH physical lines behind this visual row.
        const ids = [row.paid?.id, row.gift?.id].filter(Boolean);
        let last = null;
        for (const id of ids) {
            const result = await orderService.removeOrderItem(orderId, id);
            if (!result.success) { notify.error(t.orderError, result.error); return; }
            last = result;
        }
        if (last) onLocalOrderUpdate(last.data);
    }, [orderId, row, onLocalOrderUpdate, notify, t]);
    ...
```

Price/discount handlers keep their current bodies but target `anchor.id` instead of `item.id`, and read display values from `anchor` (`anchor.price`, `anchor.effective_price`, `anchor.discount_percent`). Rendering changes:
  - Quantity stepper displays `row.totalQty`; minus is disabled when `(row.paid ? row.paid.quantity : row.giftQty) <= 1`; plus calls `handleQuantityChange(row.totalQty + 1)`, minus `handleQuantityChange(row.totalQty - 1)`; the `InputNumber` uses `value={row.totalQty}` with `min={row.paid ? row.giftQty + 1 : 1}` (a split row can't shrink below its gift count via the total stepper; a gift-only row can go down to 1).
  - Row class gains gift state: `` className={`m-cart-row${row.giftQty > 0 ? (row.giftQty >= row.totalQty ? ' m-cart-row-gift-full' : ' m-cart-row-gift') : ''}`} ``.
  - The old inline magenta `Tag` next to the warehouse tag is removed (the pill now carries the state); the pending-sync check uses `anchor`.
  - Line total shows `fmtLineTotal(row)`: paid + gift `line_total`s summed via `(Number(row.paid?.line_total || 0) + Number(row.gift?.line_total || 0)).toFixed(2)`.
  - The action cell replaces `<GiftToggleButton .../>` + delete with delete only; `<GiftCounter enabled={giftEnabled} totalQty={row.totalQty} giftQty={row.giftQty} label={t.giftLabel} onChange={handleGiftChange}/>` renders as a new full-width line at the bottom of the row (inside the same `.m-cart-row` div, after the total cell).
  - `exceedsLocal` compares `row.totalQty` against `stockNumber`.

- [ ] **Step 2: Rework `OrderItemGroupCard` line rows** — replace the `lineRows` memo:

```javascript
    const lineRows = useMemo(
        () => pairGiftLines(group.items).map((row) => ({
            key: row.key,
            row,
            assigned: assignedCodes.has(row.warehouse_code),
        })),
        [group.items, assignedCodes],
    );
```

Pass `row={row.row}` to `CartTableRow`; `stockNumber` lookup keys off `row.row.warehouse_code`. Add a gift-count chip in the card header (after the title, before the delete button):

```javascript
    const groupGiftQty = useMemo(
        () => group.items.reduce((acc, it) => acc + (it.is_gift ? Number(it.quantity || 0) : 0), 0),
        [group.items],
    );
    ...
    {groupGiftQty > 0 && (
        <span className="m-gift-chip"><GiftOutlined/> {groupGiftQty}</span>
    )}
```

(`GiftOutlined` needs importing in OrderPanel; `GiftToggleButton` import is removed, `pairGiftLines/planGiftChange/applyGiftOps` and `GiftCounter` imports added.)

- [ ] **Step 3: Order total bar gift summary** — in the step-1 total bar:

```javascript
    const orderGiftQty = useMemo(
        () => (localOrder?.items || []).reduce(
            (acc, it) => acc + (it.is_gift ? Number(it.quantity || 0) : 0), 0),
        [localOrder?.items],
    );
    ...
    <div className="m-order-total-bar">
        <Text style={{fontSize: 15}}>
            {t.orderTotal}:
            {orderGiftQty > 0 && (
                <Text className="m-gift-sum"> · {orderGiftQty} {t.giftLabel}</Text>
            )}
        </Text>
        ...
```

- [ ] **Step 4: Delete `GiftToggleButton.js` + `GiftToggleButton.test.js`**, confirm nothing imports them:

Run: `npm test -- --watchAll=false --testPathPattern="GiftCounter|giftSplit|groupItemsBySku"` and `grep -r GiftToggleButton src/` (expect no hits).
Expected: PASS / no references.

- [ ] **Step 5: Full frontend test suite**

Run: `npm test -- --watchAll=false`
Expected: PASS.

---

### Task 5: Frontend — CSS: gift styles + mobile touch sizing

**Files:**
- Modify: `barcode-scanner-frontend/src/index.css` (cart block, ~756-1070)

**Interfaces:**
- Consumes: class names from Tasks 3-4: `.m-gift-line`, `.m-gift-pill(-idle/-partial/-full)`, `.m-gift-mini`, `.m-gift-mini-count`, `.m-gift-chip`, `.m-gift-sum`, `.m-cart-row-gift`, `.m-cart-row-gift-full`.

- [ ] **Step 1: Add gift styles (all breakpoints)** after the `.m-cart-inline-edit` block:

```css
/* ---- Gift marking (B1 pill + mini stepper) ---- */
.m-cart-row-gift,
.m-cart-row-gift-full {
    border-left: 3px solid #eb2f96;
    border-color: rgba(235, 47, 150, 0.2);
    background: rgba(235, 47, 150, 0.03);
}

.m-cart-row-gift-full {
    background: rgba(235, 47, 150, 0.05);
    border-color: rgba(235, 47, 150, 0.28);
}

.m-gift-line {
    display: flex;
    align-items: center;
    gap: 8px;
}

.m-gift-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 32px;
    padding: 0 14px;
    border-radius: 999px;
    border: 1px solid #d9d9d9;
    background: #fff;
    color: rgba(0, 0, 0, 0.55);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
}

.m-gift-pill:hover {
    border-color: #eb2f96;
    color: #eb2f96;
}

.m-gift-pill-partial {
    background: #fff0f6;
    border-color: #eb2f96;
    color: #c41d7f;
    font-weight: 600;
}

.m-gift-pill-full {
    background: #eb2f96;
    border-color: #eb2f96;
    color: #fff;
    font-weight: 600;
}

.m-gift-mini {
    display: inline-flex;
    align-items: center;
    height: 32px;
    border: 1px solid #ffadd2;
    border-radius: 8px;
    overflow: hidden;
    background: #fff;
}

.m-gift-mini button {
    width: 32px;
    height: 32px;
    border: none;
    background: #fff0f6;
    cursor: pointer;
    font-size: 13px;
    color: #c41d7f;
    line-height: 1;
}

.m-gift-mini button:disabled {
    color: rgba(196, 29, 127, 0.3);
    cursor: default;
}

.m-gift-mini-count {
    min-width: 44px;
    text-align: center;
    font-size: 12px;
    font-weight: 600;
    color: #c41d7f;
    border-left: 1px solid #ffadd2;
    border-right: 1px solid #ffadd2;
    line-height: 30px;
    padding: 0 4px;
    font-variant-numeric: tabular-nums;
}

.m-gift-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 600;
    color: #c41d7f;
    background: #fff0f6;
    border: 1px solid #ffadd2;
    border-radius: 999px;
    padding: 1px 8px;
    white-space: nowrap;
    flex-shrink: 0;
}

.m-gift-sum {
    font-size: 12px;
    color: #c41d7f;
    font-weight: 600;
}

.dark-theme .m-gift-pill,
.dark-theme .m-gift-mini {
    background: transparent;
}

.dark-theme .m-gift-mini button,
.dark-theme .m-gift-pill-partial,
.dark-theme .m-gift-chip {
    background: rgba(235, 47, 150, 0.15);
}
```

- [ ] **Step 2: Mobile touch sizing** — inside a `@media (max-width: 599px)` block (the stacked layout breakpoint, complementing the existing `min-width: 600px` desktop block):

```css
/* Touch sizing for the stacked mobile cart (44px minimum targets) */
@media (max-width: 599px) {
    .m-cart-row {
        padding: 12px;
        gap: 10px 12px;
    }

    .m-qty-stepper {
        height: 44px;
        border-radius: 10px;
    }

    .m-qty-btn {
        height: 44px !important;
        width: 44px !important;
        min-width: 44px !important;
        font-size: 18px;
    }

    .m-qty-input {
        width: 72px !important;
        height: 42px !important;
    }

    .m-qty-input .ant-input-number-input {
        height: 42px;
        font-size: 16px;
    }

    .m-cart-cell-total .ant-typography {
        font-size: 17px !important;
    }

    .m-cart-card .m-cart-card-thumb {
        flex-basis: 48px;
        width: 48px;
        height: 48px;
        font-size: 22px;
    }

    .m-gift-pill {
        height: 44px;
        padding: 0 18px;
        font-size: 14px;
        gap: 8px;
        flex: 1;
        min-width: 0;
    }

    .m-gift-mini {
        height: 44px;
        border-radius: 10px;
    }

    .m-gift-mini button {
        width: 44px;
        height: 44px;
        font-size: 17px;
    }

    .m-gift-mini-count {
        min-width: 56px;
        font-size: 14.5px;
        line-height: 42px;
    }

    .m-item-delete-btn {
        width: 44px;
        height: 44px;
    }
}
```

- [ ] **Step 3: Build check**

Run (from `barcode-scanner-frontend/`): `npm run build`
Expected: compiles without errors/warnings about unknown imports.

---

### Task 6: Verification in the running app

- [ ] **Step 1: Start the dev stack** — backend on a fresh port with the mock-1C recipe (see memory `browser-verify-recipe`): mock-1C server + `backend-verify` launch config + frontend. Use a gift-enabled org/user.
- [ ] **Step 2: In the cart, verify with an item of qty 3:**
  - Pill tap → row tints, pill shows `1/3 საჩუქარი`, mini stepper appears; the order now has two lines server-side (confirm via `/api/v1/orders/{id}/` response in the network tab).
  - `+` to 3/3 → paid line removed server-side; row shows full-gift styling.
  - `−` back to 0 → single paid line qty 3, styling cleared.
  - Quantity stepper on a split row changes only the paid side; total updates.
  - Delete on a split row removes both lines.
  - Card header shows the 🎁 chip; total bar shows `· N საჩუქარი`.
- [ ] **Step 3: Mobile viewport (375px)** — all gift controls ≥44px; pill full-width on its own line.
- [ ] **Step 4: Report results to the user with screenshots; ask about committing.**

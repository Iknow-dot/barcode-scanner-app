# Cart Group-By-SKU Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group cart line items by `sku` in `OrderPanel`, with shared price/discount/unit controls and a tap-to-expand per-warehouse breakdown. Add a single backend bulk-update endpoint so "set price for all" is atomic. Data model unchanged.

**Architecture:** Frontend-led grouping (group is a UI projection over `(sku, warehouse_code)` rows). New `PATCH /api/v1/orders/<id>/items/bulk-update/` action on `PurchaseOrderViewSet` updates many lines in one transaction. The existing `add_item` already accepts `price`/`discount_percent`/`discounted_price`/`unit`, so "inherit on new warehouse" is a frontend-only payload change.

**Tech Stack:** Django 6 / DRF / drf-spectacular / SimpleJWT (backend); React 18 / Ant Design 6 / CRA (frontend).

**Spec:** `docs/superpowers/specs/2026-05-04-cart-group-by-sku-design.md`

---

## File Map

**Backend:**
- Modify `backend/core/views.py` — add `bulk_update_items` action on `PurchaseOrderViewSet`; register it in the `@extend_schema_view` decorator.
- Modify `backend/core/serializers.py` — add `BulkUpdateOrderItemsSerializer` for input validation.
- Modify `backend/core/tests.py` — add `PurchaseOrderBulkUpdateTests`.

**Frontend:**
- Modify `barcode-scanner-frontend/src/api/endpoints.js` — add `order_items_bulk_update` URL builder.
- Modify `barcode-scanner-frontend/src/api/services/orderService.js` — add `bulkUpdateOrderItems`.
- Create `barcode-scanner-frontend/src/components/UserDashboard/groupItemsBySku.js` — pure helper.
- Create `barcode-scanner-frontend/src/components/UserDashboard/groupItemsBySku.test.js` — Jest unit tests.
- Modify `barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js` — replace per-line rendering with `OrderItemGroupCard`; add `WarehouseSubRow`; integrate confirm modal.
- Modify `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js` — inherit-on-add payload in `handleAddToOrderFromWarehouse`.
- Modify `barcode-scanner-frontend/src/i18n/translations.js` — add new keys.
- Modify `barcode-scanner-frontend/src/components/UserDashboard/BarcodeScanner.css` (or wherever `m-order-item-card` styles live) — small additions for sub-rows + mixed tag.

---

## Task 1: Backend — input serializer for bulk-update (TDD)

**Files:**
- Modify: `backend/core/serializers.py`
- Modify: `backend/core/tests.py`

Adds the input shape `{item_ids: [int], data: {price?, discount_percent?, discounted_price?, unit?}}` and rejects empty `item_ids` or empty `data`.

- [ ] **Step 1: Write the failing test**

Append at the bottom of `backend/core/tests.py`:

```python
# ---------------------------------------------------------------------------
# Bulk update order items
# ---------------------------------------------------------------------------

class BulkUpdateOrderItemsSerializerTests(TestCase):
    def test_rejects_empty_item_ids(self):
        from core.serializers import BulkUpdateOrderItemsSerializer
        s = BulkUpdateOrderItemsSerializer(data={'item_ids': [], 'data': {'price': '10.00'}})
        self.assertFalse(s.is_valid())
        self.assertIn('item_ids', s.errors)

    def test_rejects_missing_item_ids(self):
        from core.serializers import BulkUpdateOrderItemsSerializer
        s = BulkUpdateOrderItemsSerializer(data={'data': {'price': '10.00'}})
        self.assertFalse(s.is_valid())
        self.assertIn('item_ids', s.errors)

    def test_rejects_empty_data(self):
        from core.serializers import BulkUpdateOrderItemsSerializer
        s = BulkUpdateOrderItemsSerializer(data={'item_ids': [1, 2], 'data': {}})
        self.assertFalse(s.is_valid())
        self.assertIn('data', s.errors)

    def test_accepts_valid_payload(self):
        from core.serializers import BulkUpdateOrderItemsSerializer
        s = BulkUpdateOrderItemsSerializer(data={
            'item_ids': [1, 2, 3],
            'data': {'price': '12.50', 'unit': 'piece', 'discount_percent': '5.00'},
        })
        self.assertTrue(s.is_valid(), s.errors)
        self.assertEqual(s.validated_data['item_ids'], [1, 2, 3])
        self.assertEqual(s.validated_data['data']['unit'], 'piece')

    def test_accepts_discounted_price_null(self):
        from core.serializers import BulkUpdateOrderItemsSerializer
        s = BulkUpdateOrderItemsSerializer(data={
            'item_ids': [1],
            'data': {'discounted_price': None, 'discount_percent': '0'},
        })
        self.assertTrue(s.is_valid(), s.errors)
        self.assertIsNone(s.validated_data['data']['discounted_price'])
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python manage.py test core.tests.BulkUpdateOrderItemsSerializerTests -v 2
```

Expected: `ImportError` (`BulkUpdateOrderItemsSerializer` doesn't exist).

- [ ] **Step 3: Implement the serializer**

In `backend/core/serializers.py`, append below `AddOrderItemSerializer` (around line 361):

```python
class BulkUpdateOrderItemsDataSerializer(serializers.Serializer):
    """Whitelisted fields the bulk-update endpoint may set on each item.

    All fields are optional; at least one must be provided (validated by the
    parent serializer).
    """
    price = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False,
    )
    quantity = serializers.IntegerField(min_value=1, required=False)
    unit = serializers.CharField(max_length=50, required=False, allow_blank=True)
    discount_percent = serializers.DecimalField(
        max_digits=5, decimal_places=2, required=False,
    )
    discounted_price = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True,
    )


class BulkUpdateOrderItemsSerializer(serializers.Serializer):
    """Input for the bulk-update action: a non-empty list of item ids and a
    non-empty whitelisted data dict applied to every listed item."""
    item_ids = serializers.ListField(
        child=serializers.IntegerField(),
        allow_empty=False,
    )
    data = BulkUpdateOrderItemsDataSerializer()

    def validate_data(self, value):
        if not value:
            raise serializers.ValidationError(
                'At least one field must be provided.'
            )
        return value
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python manage.py test core.tests.BulkUpdateOrderItemsSerializerTests -v 2
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/core/serializers.py backend/core/tests.py
git commit -m "feat(orders): bulk-update input serializer

Validates {item_ids: [...], data: {...}} payload for the upcoming
bulk-update action: rejects empty item_ids, missing item_ids, or
empty data; accepts whitelisted fields including discounted_price=null.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Backend — bulk_update_items action (TDD)

**Files:**
- Modify: `backend/core/views.py`
- Modify: `backend/core/tests.py`

Adds `PATCH /api/v1/orders/<id>/items/bulk-update/`. Wraps the per-item update loop in `transaction.atomic()`, runs `_enforce_discount_permission` per item, and returns the refreshed order on success.

- [ ] **Step 1: Write the failing test (happy path)**

Append to `backend/core/tests.py`:

```python
class PurchaseOrderBulkUpdateTests(TestCase):
    def setUp(self):
        self.org = _make_organization()
        self.user = User.objects.create_user(
            username='consultant', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
            can_apply_discount=True, max_discount_percent=20,
        )
        self.order = PurchaseOrder.objects.create(
            organization=self.org, created_by=self.user,
            customer_name='Cust',
        )
        self.item_a = PurchaseOrderItem.objects.create(
            order=self.order, sku='SKU1', sku_name='Widget',
            price='100.00', quantity=2, warehouse_code='WHA',
            warehouse_name='WH-A',
        )
        self.item_b = PurchaseOrderItem.objects.create(
            order=self.order, sku='SKU1', sku_name='Widget',
            price='100.00', quantity=3, warehouse_code='WHB',
            warehouse_name='WH-B',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.url = f'/api/v1/orders/{self.order.id}/items/bulk-update/'

    def test_bulk_update_price_applies_to_listed_items(self):
        response = self.client.patch(
            self.url,
            {'item_ids': [self.item_a.id, self.item_b.id],
             'data': {'price': '90.00'}},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.item_a.refresh_from_db()
        self.item_b.refresh_from_db()
        self.assertEqual(str(self.item_a.price), '90.00')
        self.assertEqual(str(self.item_b.price), '90.00')

    def test_bulk_update_returns_refreshed_order_with_recomputed_total(self):
        response = self.client.patch(
            self.url,
            {'item_ids': [self.item_a.id, self.item_b.id],
             'data': {'price': '50.00'}},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        # 2 * 50 + 3 * 50 = 250
        self.assertEqual(str(response.data['total']), '250.00')
        self.assertEqual(len(response.data['items']), 2)
        for item in response.data['items']:
            self.assertEqual(str(item['price']), '50.00')

    def test_bulk_update_silently_skips_ids_not_in_this_order(self):
        # An item from a *different* order in the same org — must NOT be touched.
        other_order = PurchaseOrder.objects.create(
            organization=self.org, created_by=self.user, customer_name='Other',
        )
        other_item = PurchaseOrderItem.objects.create(
            order=other_order, sku='SKU2', price='999.00', quantity=1,
        )
        response = self.client.patch(
            self.url,
            {'item_ids': [self.item_a.id, other_item.id],
             'data': {'price': '11.00'}},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.item_a.refresh_from_db()
        other_item.refresh_from_db()
        self.assertEqual(str(self.item_a.price), '11.00')
        self.assertEqual(str(other_item.price), '999.00')
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python manage.py test core.tests.PurchaseOrderBulkUpdateTests -v 2
```

Expected: 404 (the URL doesn't exist yet).

- [ ] **Step 3: Implement the action**

In `backend/core/views.py`, register the action in `@extend_schema_view` (around line 627):

```python
@extend_schema_view(
    list=extend_schema(tags=['Purchase Orders']),
    retrieve=extend_schema(tags=['Purchase Orders']),
    create=extend_schema(tags=['Purchase Orders']),
    update=extend_schema(tags=['Purchase Orders']),
    partial_update=extend_schema(tags=['Purchase Orders']),
    destroy=extend_schema(tags=['Purchase Orders']),
    add_item=extend_schema(tags=['Purchase Orders']),
    remove_item=extend_schema(tags=['Purchase Orders']),
    update_item=extend_schema(tags=['Purchase Orders']),
    bulk_update_items=extend_schema(tags=['Purchase Orders']),
    invoice=extend_schema(tags=['Purchase Orders']),
    invoice_preview=extend_schema(tags=['Purchase Orders']),
)
class PurchaseOrderViewSet(ModelViewSet):
    ...
```

Add the action below `update_item` (after the existing `_prefetched_objects_cache` clear). Insert near the bottom of the existing `update_item` method (just after its `Response` return). Locate the closing of `update_item` first — currently around line 835 — then add:

```python
    @action(detail=True, methods=['patch'], url_path='items/bulk-update')
    def bulk_update_items(self, request, pk=None):
        """Apply a partial update to multiple line items atomically.

        Body: {"item_ids": [int, ...], "data": {price?, discount_percent?,
        discounted_price?, unit?}}. Items not belonging to this order are
        silently filtered. Permission denial on any item rolls back the
        whole batch.
        """
        from django.db import transaction

        order = self.get_object()
        serializer = BulkUpdateOrderItemsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        item_ids = serializer.validated_data['item_ids']
        data = serializer.validated_data['data']

        items = list(order.items.filter(pk__in=item_ids))

        with transaction.atomic():
            for item in items:
                is_changing_discount = (
                    'discount_percent' in data or 'discounted_price' in data
                )
                if is_changing_discount:
                    discount_percent = data.get(
                        'discount_percent', item.discount_percent,
                    )
                    discounted_price = data.get(
                        'discounted_price', item.discounted_price,
                    )
                    denied = _enforce_discount_permission(
                        request.user,
                        base_price=data.get('price', item.price),
                        discount_percent=discount_percent,
                        discounted_price=discounted_price,
                    )
                    if denied is not None:
                        # Annotate with which item triggered the denial so the
                        # frontend can surface it. transaction.atomic() rolls
                        # back any earlier item updates.
                        body = dict(denied.data)
                        body['failed_item_id'] = item.id
                        transaction.set_rollback(True)
                        return Response(body, status=denied.status_code)

                item_serializer = PurchaseOrderItemSerializer(
                    item, data=data, partial=True,
                )
                item_serializer.is_valid(raise_exception=True)
                item_serializer.save()

        order.refresh_from_db()
        try:
            del order._prefetched_objects_cache
        except AttributeError:
            pass
        return Response(PurchaseOrderSerializer(order).data)
```

Make sure the import is present near the top of `backend/core/views.py` (it likely already imports the existing serializers; add `BulkUpdateOrderItemsSerializer` to the same import line):

```python
from core.serializers import (
    ...,
    BulkUpdateOrderItemsSerializer,
)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python manage.py test core.tests.PurchaseOrderBulkUpdateTests -v 2
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/core/views.py backend/core/tests.py
git commit -m "feat(orders): bulk-update items action

PATCH /orders/<id>/items/bulk-update/ updates many lines atomically.
Silently filters item_ids that don't belong to the order. Returns the
refreshed order with recomputed total.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Backend — discount-denial rollback + cross-org scoping (TDD)

**Files:**
- Modify: `backend/core/tests.py`

Verifies that mid-batch denial rolls back the whole transaction and that another org's order can't be touched.

- [ ] **Step 1: Write the failing tests**

Append to `PurchaseOrderBulkUpdateTests`:

```python
    def test_discount_denial_rolls_back_whole_batch(self):
        self.user.max_discount_percent = 10  # cap discount at 10%
        self.user.save()
        # Setting price=50 implies a 50% discount on a base of 100, exceeding
        # the cap. The whole batch must roll back so item_a is also unchanged.
        response = self.client.patch(
            self.url,
            {'item_ids': [self.item_a.id, self.item_b.id],
             'data': {'discounted_price': '50.00'}},
            format='json',
        )
        self.assertEqual(response.status_code, 403, response.data)
        self.assertEqual(response.data['code'], 'DISCOUNT_EXCEEDS_LIMIT')
        self.assertIn('failed_item_id', response.data)
        self.item_a.refresh_from_db()
        self.item_b.refresh_from_db()
        # Neither item was mutated — full rollback.
        self.assertIsNone(self.item_a.discounted_price)
        self.assertIsNone(self.item_b.discounted_price)

    def test_other_org_order_returns_404(self):
        other_org = _make_organization(name='Other', identification_number='999')
        other_user = User.objects.create_user(
            username='outsider', password='p',
            role=User.Role.COMPANY_USER, organization=other_org,
        )
        other_client = APIClient()
        other_client.force_authenticate(user=other_user)
        response = other_client.patch(
            self.url,  # this points at self.org's order
            {'item_ids': [self.item_a.id], 'data': {'price': '1.00'}},
            format='json',
        )
        # PurchaseOrderViewSet.get_queryset filters by user.organization, so a
        # cross-org order is invisible (404), not a 403.
        self.assertEqual(response.status_code, 404)
        self.item_a.refresh_from_db()
        self.assertEqual(str(self.item_a.price), '100.00')

    def test_unit_only_change_does_not_trigger_discount_check(self):
        # User has no discount permission — but a pure unit change must succeed.
        self.user.can_apply_discount = False
        self.user.save()
        response = self.client.patch(
            self.url,
            {'item_ids': [self.item_a.id, self.item_b.id],
             'data': {'unit': 'box'}},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.item_a.refresh_from_db()
        self.item_b.refresh_from_db()
        self.assertEqual(self.item_a.unit, 'box')
        self.assertEqual(self.item_b.unit, 'box')
```

- [ ] **Step 2: Run tests to verify they pass (or fail meaningfully)**

```bash
cd backend && python manage.py test core.tests.PurchaseOrderBulkUpdateTests -v 2
```

Expected: all 6 tests pass — Task 2's implementation already covers these paths. If a test fails, fix the implementation in `views.py` before continuing.

- [ ] **Step 3: Commit**

```bash
git add backend/core/tests.py
git commit -m "test(orders): bulk-update rollback and cross-org scoping

Verifies discount-denial mid-batch rolls back the whole transaction
(carrying failed_item_id), cross-org orders return 404, and a
pure unit change skips the discount check.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Frontend — endpoint + service method

**Files:**
- Modify: `barcode-scanner-frontend/src/api/endpoints.js`
- Modify: `barcode-scanner-frontend/src/api/services/orderService.js`

- [ ] **Step 1: Add the endpoint URL builder**

In `barcode-scanner-frontend/src/api/endpoints.js`, add inside the `Purchase Orders` block (just below the existing `order_item_update` line):

```javascript
    order_items_bulk_update: orderId => `api/v1/orders/${orderId}/items/bulk-update/`,
```

- [ ] **Step 2: Add the service method**

In `barcode-scanner-frontend/src/api/services/orderService.js`, append below `updateOrderItem`:

```javascript
/**
 * Bulk-update multiple line items in a single atomic request.
 * @param {number} orderId
 * @param {number[]} itemIds - Line item IDs to update; ids not belonging to the order are ignored server-side.
 * @param {object} data - Fields to apply to every listed item: { price?, quantity?, unit?, discount_percent?, discounted_price? }
 * @returns The refreshed order in {success, data, error} envelope.
 */
export const bulkUpdateOrderItems = (orderId, itemIds, data) => {
    return api.patch(API_ENDPOINTS.order_items_bulk_update(orderId), {
        item_ids: itemIds,
        data,
    });
};
```

- [ ] **Step 3: Verify the named export is picked up**

Check that `barcode-scanner-frontend/src/api/index.js` (the orderService re-export) doesn't need an explicit add. If `orderService` is exported as `export * from './services/orderService'` or `export * as orderService from ...`, the new function is included automatically. Run:

```bash
cd barcode-scanner-frontend && grep -n "orderService" src/api/index.js
```

If the index uses an explicit named list, add `bulkUpdateOrderItems` there. Otherwise no change.

- [ ] **Step 4: Commit**

```bash
git add barcode-scanner-frontend/src/api/endpoints.js \
        barcode-scanner-frontend/src/api/services/orderService.js \
        barcode-scanner-frontend/src/api/index.js
git commit -m "feat(orders): bulkUpdateOrderItems API client

Adds the orderService.bulkUpdateOrderItems wrapper around the new
backend bulk-update endpoint.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frontend — `groupItemsBySku` helper (TDD)

**Files:**
- Create: `barcode-scanner-frontend/src/components/UserDashboard/groupItemsBySku.js`
- Create: `barcode-scanner-frontend/src/components/UserDashboard/groupItemsBySku.test.js`

Pure function that reduces an order's `items` array into an array of group objects (one per SKU).

- [ ] **Step 1: Write the failing test**

Create `barcode-scanner-frontend/src/components/UserDashboard/groupItemsBySku.test.js`:

```javascript
import groupItemsBySku from './groupItemsBySku';

const mkItem = (overrides) => ({
    id: 1,
    sku: 'SKU1',
    sku_name: 'Widget',
    article: 'ART1',
    price: '100.00',
    quantity: 1,
    warehouse_code: 'WHA',
    warehouse_name: 'WH-A',
    unit: 'piece',
    discount_percent: '0.00',
    discounted_price: null,
    effective_price: '100.00',
    line_total: '100.00',
    added_at: '2026-05-04T10:00:00Z',
    ...overrides,
});

describe('groupItemsBySku', () => {
    it('returns an empty array for no items', () => {
        expect(groupItemsBySku([])).toEqual([]);
    });

    it('returns one group per unique SKU, preserving first-added order', () => {
        const items = [
            mkItem({id: 1, sku: 'A', added_at: '2026-05-04T10:00:00Z'}),
            mkItem({id: 2, sku: 'B', added_at: '2026-05-04T10:01:00Z'}),
            mkItem({id: 3, sku: 'A', warehouse_code: 'WHB', added_at: '2026-05-04T10:02:00Z'}),
        ];
        const groups = groupItemsBySku(items);
        expect(groups.map(g => g.sku)).toEqual(['A', 'B']);
        expect(groups[0].items.map(i => i.id)).toEqual([1, 3]);
        expect(groups[1].items.map(i => i.id)).toEqual([2]);
    });

    it('flags shared price/discount/unit when all lines agree', () => {
        const items = [
            mkItem({id: 1, warehouse_code: 'WHA', effective_price: '90.00', discount_percent: '10.00'}),
            mkItem({id: 2, warehouse_code: 'WHB', effective_price: '90.00', discount_percent: '10.00'}),
        ];
        const [g] = groupItemsBySku(items);
        expect(g.isMixedPrice).toBe(false);
        expect(g.sharedPrice).toBe('90.00');
        expect(g.isMixedDiscount).toBe(false);
        expect(g.sharedDiscountPercent).toBe('10.00');
        expect(g.isMixedUnit).toBe(false);
        expect(g.sharedUnit).toBe('piece');
    });

    it('flags mixed when effective prices differ across warehouses', () => {
        const items = [
            mkItem({id: 1, warehouse_code: 'WHA', effective_price: '80.00'}),
            mkItem({id: 2, warehouse_code: 'WHB', effective_price: '100.00'}),
        ];
        const [g] = groupItemsBySku(items);
        expect(g.isMixedPrice).toBe(true);
        expect(g.sharedPrice).toBeNull();
        expect(g.minPrice).toBe('80.00');
        expect(g.maxPrice).toBe('100.00');
    });

    it('sums quantity and line_total across the group', () => {
        const items = [
            mkItem({id: 1, quantity: 2, line_total: '200.00'}),
            mkItem({id: 2, warehouse_code: 'WHB', quantity: 3, line_total: '300.00'}),
        ];
        const [g] = groupItemsBySku(items);
        expect(g.totalQty).toBe(5);
        expect(g.groupLineTotal).toBe('500.00');
    });

    it('treats discount as mixed if one line uses percent and another uses discounted_price', () => {
        const items = [
            mkItem({id: 1, discount_percent: '10.00', discounted_price: null}),
            mkItem({id: 2, warehouse_code: 'WHB', discount_percent: '0.00', discounted_price: '90.00'}),
        ];
        const [g] = groupItemsBySku(items);
        expect(g.isMixedDiscount).toBe(true);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd barcode-scanner-frontend && CI=true npm test -- --testPathPattern=groupItemsBySku
```

Expected: module-not-found error (`groupItemsBySku.js` doesn't exist yet).

- [ ] **Step 3: Implement the helper**

Create `barcode-scanner-frontend/src/components/UserDashboard/groupItemsBySku.js`:

```javascript
/**
 * Reduce a flat list of PurchaseOrderItems into an array of group objects
 * keyed by `sku`. A group is purely a UI projection — the underlying rows
 * are unchanged.
 *
 * Decimal-typed fields (price, discount_percent, discounted_price,
 * effective_price, line_total) arrive from DRF as strings. Comparisons in
 * this module are done as strings to avoid floating-point drift; sums are
 * done by parsing to Number then re-formatting to two decimals on output.
 */

const allEqual = (arr) => arr.every((v) => v === arr[0]);

const fmt = (n) => Number(n).toFixed(2);

const sum = (items, key) =>
    items.reduce((acc, it) => acc + Number(it[key] || 0), 0);

const minMax = (items, key) => {
    const nums = items.map((it) => Number(it[key] || 0));
    return [fmt(Math.min(...nums)), fmt(Math.max(...nums))];
};

const groupItemsBySku = (items) => {
    if (!Array.isArray(items) || items.length === 0) return [];

    // Preserve insertion order — first time we see a SKU defines its slot.
    const order = [];
    const groups = new Map();

    for (const it of items) {
        if (!groups.has(it.sku)) {
            order.push(it.sku);
            groups.set(it.sku, []);
        }
        groups.get(it.sku).push(it);
    }

    return order.map((sku) => {
        const lines = groups.get(sku);
        const first = lines[0];

        const effectivePrices = lines.map((l) => l.effective_price);
        const isMixedPrice = !allEqual(effectivePrices);
        const sharedPrice = isMixedPrice ? null : effectivePrices[0];
        const [minPrice, maxPrice] = minMax(lines, 'effective_price');

        const discountSignatures = lines.map((l) => `${l.discount_percent}|${l.discounted_price ?? ''}`);
        const isMixedDiscount = !allEqual(discountSignatures);
        const sharedDiscountPercent = isMixedDiscount ? null : lines[0].discount_percent;
        const sharedDiscountedPrice = isMixedDiscount ? null : lines[0].discounted_price;

        const units = lines.map((l) => l.unit || '');
        const isMixedUnit = !allEqual(units);
        const sharedUnit = isMixedUnit ? null : units[0];

        return {
            sku,
            sku_name: first.sku_name,
            article: first.article,
            items: lines,
            sharedPrice,
            minPrice,
            maxPrice,
            isMixedPrice,
            sharedDiscountPercent,
            sharedDiscountedPrice,
            isMixedDiscount,
            sharedUnit,
            isMixedUnit,
            totalQty: lines.reduce((acc, l) => acc + Number(l.quantity || 0), 0),
            groupLineTotal: fmt(sum(lines, 'line_total')),
        };
    });
};

export default groupItemsBySku;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd barcode-scanner-frontend && CI=true npm test -- --testPathPattern=groupItemsBySku
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/groupItemsBySku.js \
        barcode-scanner-frontend/src/components/UserDashboard/groupItemsBySku.test.js
git commit -m "feat(cart): groupItemsBySku helper

Pure reducer that projects flat order items into per-SKU groups with
shared/mixed flags for price, discount, and unit. Preserves first-seen
order so the cart isn't reshuffled when a second warehouse is added.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Frontend — `OrderItemGroupCard` scaffold (single-warehouse parity)

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js`

Wraps the existing `OrderItemCard` rendering with a per-group container, but for single-warehouse groups the visible UI is unchanged.

- [ ] **Step 1: Replace the items map with grouping**

In `barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js`, near the top imports add:

```javascript
import groupItemsBySku from './groupItemsBySku';
```

Inside the `OrderPanel` component body (around line 567 — right after the `unitOptions` line), add:

```javascript
    const groups = useMemo(
        () => groupItemsBySku(localOrder?.items || []),
        [localOrder?.items],
    );
```

Then locate the existing items map (around lines 656-669) and replace:

```javascript
{localOrder.items.map((item) => (
    <OrderItemCard
        key={item.id}
        item={item}
        orderId={localOrder.id}
        onLocalOrderUpdate={handleLocalOrderUpdate}
        notify={notify}
        t={t}
        unitOptions={unitOptions}
        discountConfig={discountConfig}
    />
))}
```

with:

```javascript
{groups.map((group) => (
    <OrderItemGroupCard
        key={group.sku}
        group={group}
        orderId={localOrder.id}
        onLocalOrderUpdate={handleLocalOrderUpdate}
        notify={notify}
        t={t}
        unitOptions={unitOptions}
        discountConfig={discountConfig}
    />
))}
```

- [ ] **Step 2: Add the OrderItemGroupCard component (single-warehouse only for now)**

Insert the new component just above `OrderItemCard` (around line 95 in `OrderPanel.js`). For now, single-warehouse groups simply delegate to `OrderItemCard` — multi-warehouse groups render a stub:

```javascript
const OrderItemGroupCard = memo(({
    group,
    orderId,
    onLocalOrderUpdate,
    notify,
    t,
    unitOptions,
    discountConfig,
}) => {
    if (group.items.length === 1) {
        return (
            <OrderItemCard
                item={group.items[0]}
                orderId={orderId}
                onLocalOrderUpdate={onLocalOrderUpdate}
                notify={notify}
                t={t}
                unitOptions={unitOptions}
                discountConfig={discountConfig}
            />
        );
    }
    // Multi-warehouse rendering lands in Task 7.
    return (
        <div className="m-order-item-card">
            <Text strong>{group.sku_name || group.sku}</Text>
            <Text type="secondary"> · {group.items.length} {t.warehouses || 'warehouses'}</Text>
        </div>
    );
});

OrderItemGroupCard.displayName = 'OrderItemGroupCard';
```

- [ ] **Step 3: Smoke-test parity**

Run the dev server and confirm the cart looks identical for single-warehouse items:

```bash
docker-compose up -d
# open http://localhost:3000, log in, scan a product, confirm the order item card looks unchanged.
```

If the visual matches today's build, parity is preserved. If not, debug before proceeding.

- [ ] **Step 4: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js
git commit -m "feat(cart): wrap items with OrderItemGroupCard

Render groups (one per SKU) instead of flat items. Single-warehouse
groups delegate to the existing OrderItemCard for full visual parity.
Multi-warehouse groups currently render a placeholder stub — fleshed
out in subsequent tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Frontend — multi-warehouse collapsed view

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js`

Replaces the placeholder stub from Task 6 with the real collapsed-by-default UI: header, warehouse-tag chips, total quantity, price (or `$min – $max` + Mixed tag), shared unit `<Select>`, shared discount control, group line total.

- [ ] **Step 1: Implement the collapsed layout**

Replace the multi-warehouse branch in `OrderItemGroupCard` from Task 6. The full component now becomes:

```javascript
const OrderItemGroupCard = memo(({
    group,
    orderId,
    onLocalOrderUpdate,
    notify,
    t,
    unitOptions,
    discountConfig,
}) => {
    const [expanded, setExpanded] = useState(false);
    const {canApplyDiscount, maxDiscountPercent} = discountConfig;

    if (group.items.length === 1) {
        return (
            <OrderItemCard
                item={group.items[0]}
                orderId={orderId}
                onLocalOrderUpdate={onLocalOrderUpdate}
                notify={notify}
                t={t}
                unitOptions={unitOptions}
                discountConfig={discountConfig}
            />
        );
    }

    // ----- Multi-warehouse group -----
    const itemIds = group.items.map((i) => i.id);

    const handleRemoveGroup = async () => {
        // Remove every line in the group; backend has no group concept, so we
        // issue parallel deletes. Last successful response wins for the
        // refreshed-order shape.
        let lastOrder = null;
        for (const id of itemIds) {
            const res = await orderService.removeOrderItem(orderId, id);
            if (res.success) {
                lastOrder = res.data;
            } else {
                notify.error(t.orderError, res.error);
                return;
            }
        }
        if (lastOrder) onLocalOrderUpdate(lastOrder);
    };

    const priceDisplay = group.isMixedPrice ? (
        <Flex align="center" gap={6}>
            <Text strong style={{fontSize: 13}}>
                {group.minPrice} ₾ – {group.maxPrice} ₾
            </Text>
            <Tag color="orange" style={{fontSize: 10, marginInlineEnd: 0}}>
                {t.mixed || 'Mixed'}
            </Tag>
        </Flex>
    ) : (
        <Text strong style={{fontSize: 13}}>{group.sharedPrice} ₾</Text>
    );

    return (
        <div className="m-order-item-card m-order-item-group-card">
            {/* Header: name + delete */}
            <Flex justify="space-between" align="start" gap={8}>
                <div style={{flex: 1, minWidth: 0}}>
                    <Text strong style={{fontSize: 14, display: 'block'}} ellipsis>
                        {group.sku_name || group.sku}
                    </Text>
                    {group.article && (
                        <Text type="secondary" style={{fontSize: 12}}>
                            {t.article}: {group.article}
                        </Text>
                    )}
                </div>
                <Popconfirm
                    title={t.removeFromAllWarehouses || 'Remove product from all warehouses?'}
                    onConfirm={handleRemoveGroup}
                    okText={t.yes}
                    cancelText={t.no}
                >
                    <Button type="text" danger size="small" icon={<DeleteOutlined/>} className="m-item-delete-btn"/>
                </Popconfirm>
            </Flex>

            {/* Warehouse summary row */}
            <Flex align="center" wrap="wrap" gap={6} style={{marginTop: 6}}>
                {group.items.map((it) => (
                    <Tag key={it.id} color="blue" style={{fontSize: 10}}>
                        {it.warehouse_name}
                    </Tag>
                ))}
                <Button type="link" size="small" onClick={() => setExpanded((v) => !v)} style={{padding: 0}}>
                    {expanded
                        ? (t.collapse || 'Collapse')
                        : (t.expandWarehouses || `Expand (${group.items.length} warehouses)`)}
                </Button>
            </Flex>

            {/* Price + total qty row */}
            <Flex align="center" gap={8} style={{marginTop: 8}}>
                <Text type="secondary" style={{fontSize: 12}}>{t.price}:</Text>
                {priceDisplay}
                <Divider type="vertical"/>
                <Text type="secondary" style={{fontSize: 12}}>
                    {t.total || 'Total'}: {group.totalQty} {group.sharedUnit || ''}
                </Text>
            </Flex>

            {/* Shared unit + shared discount controls — wired in Task 9. For now,
                disabled placeholders so the layout is visible end-to-end. */}
            <Flex gap={8} wrap="wrap" align="center" style={{marginTop: 10}}>
                <Select
                    value={group.sharedUnit || undefined}
                    size="small"
                    allowClear
                    showSearch
                    placeholder={group.isMixedUnit ? (t.mixed || 'Mixed') : t.unit}
                    className="m-unit-select"
                    options={unitOptions}
                    disabled
                />
                {canApplyDiscount && maxDiscountPercent > 0 && (
                    <Tag color="default" style={{fontSize: 10}}>
                        {group.isMixedDiscount
                            ? (t.mixed || 'Mixed')
                            : `${group.sharedDiscountPercent || 0}%`}
                    </Tag>
                )}
            </Flex>

            {/* Line total */}
            <Flex justify="end" style={{marginTop: 8}}>
                <Text strong style={{color: '#52c41a', fontSize: 15}}>
                    {group.groupLineTotal} ₾
                </Text>
            </Flex>

            {/* Expanded section — fleshed out in Task 8. */}
            {expanded && (
                <div className="m-order-item-group-expanded">
                    {/* Stub — replaced in Task 8. */}
                    <Text type="secondary">{t.expandedComingSoon || ''}</Text>
                </div>
            )}
        </div>
    );
});

OrderItemGroupCard.displayName = 'OrderItemGroupCard';
```

Add `useState` to the existing React import at the top of the file if not already imported. Add `Divider` to the antd import if not already present (it is — line 21).

- [ ] **Step 2: Smoke-test the collapsed view**

```bash
# In the running dev stack, add the same product from two different warehouses to a cart.
# Confirm: one card per SKU; warehouse name tags visible; "$min – $max · Mixed" or single price; total qty shown; expand link present (toggle does nothing visible yet).
```

- [ ] **Step 3: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js
git commit -m "feat(cart): collapsed multi-warehouse group view

Renders one card per SKU when the same product spans multiple
warehouses: warehouse name tags, total qty, shared-or-range price
display with a Mixed tag, and an Expand toggle. Shared controls are
read-only placeholders here — bulk-update wiring lands in Task 9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Frontend — multi-warehouse expanded view + per-warehouse override

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js`

Replaces the expanded stub with per-warehouse sub-rows: warehouse tag, qty stepper (existing `update_item`), per-line total, and an "Override price" pencil that reveals a small inline price input.

- [ ] **Step 1: Add the WarehouseSubRow component**

Insert just above `OrderItemGroupCard`:

```javascript
const WarehouseSubRow = memo(({item, orderId, onLocalOrderUpdate, notify, t}) => {
    const [overrideOpen, setOverrideOpen] = useState(false);

    const handleQuantityChange = useCallback(async (newQuantity) => {
        if (newQuantity < 1) return;
        const result = await orderService.updateOrderItem(orderId, item.id, {quantity: newQuantity});
        if (result.success) onLocalOrderUpdate(result.data);
        else notify.error(t.orderError, result.error);
    }, [orderId, item.id, onLocalOrderUpdate, notify, t]);

    const handleOverrideSave = useCallback(async (val) => {
        const result = await orderService.updateOrderItem(orderId, item.id, {
            discounted_price: val == null ? null : val,
            discount_percent: 0,
        });
        if (result.success) onLocalOrderUpdate(result.data);
        else notify.error(t.orderError, result.error);
    }, [orderId, item.id, onLocalOrderUpdate, notify, t]);

    return (
        <Flex align="center" wrap="wrap" gap={8} className="m-warehouse-subrow">
            <Tag color="blue" style={{fontSize: 10, marginInlineEnd: 0}}>
                {item.warehouse_name}
            </Tag>

            <div className="m-qty-stepper">
                <Button size="small" icon={<MinusOutlined/>}
                        onClick={() => handleQuantityChange(item.quantity - 1)}
                        disabled={item.quantity <= 1}
                        className="m-qty-btn"/>
                <InputNumber min={1} value={item.quantity} size="small"
                             onChange={handleQuantityChange}
                             className="m-qty-input"
                             controls={false} inputMode="numeric" pattern="[0-9]*"/>
                <Button size="small" icon={<PlusOutlined/>}
                        onClick={() => handleQuantityChange(item.quantity + 1)}
                        className="m-qty-btn"/>
            </div>

            <Text type="secondary" style={{fontSize: 12}}>
                @ {item.effective_price} ₾
            </Text>
            <Text strong style={{fontSize: 13, color: '#52c41a'}}>
                = {item.line_total} ₾
            </Text>

            <Button type="link" size="small" onClick={() => setOverrideOpen((v) => !v)}>
                {overrideOpen ? (t.cancel || 'Cancel') : (t.overridePrice || 'Override price')}
            </Button>

            {overrideOpen && (
                <InputNumber
                    min={0}
                    max={parseFloat(item.price || 0)}
                    defaultValue={parseFloat(item.discounted_price ?? item.price)}
                    size="small"
                    addonAfter="₾"
                    controls={false}
                    inputMode="decimal"
                    onBlur={(e) => {
                        const v = parseFloat(e.target.value);
                        handleOverrideSave(Number.isFinite(v) ? v : null);
                        setOverrideOpen(false);
                    }}
                />
            )}
        </Flex>
    );
});

WarehouseSubRow.displayName = 'WarehouseSubRow';
```

- [ ] **Step 2: Replace the expanded stub in `OrderItemGroupCard`**

Find the `{expanded && (...)}` block from Task 7 and replace with:

```javascript
            {expanded && (
                <div className="m-order-item-group-expanded">
                    {group.items.map((it) => (
                        <WarehouseSubRow
                            key={it.id}
                            item={it}
                            orderId={orderId}
                            onLocalOrderUpdate={onLocalOrderUpdate}
                            notify={notify}
                            t={t}
                        />
                    ))}
                </div>
            )}
```

- [ ] **Step 3: Add minimal CSS for the sub-row**

Find `m-order-item-card` styles (likely in `barcode-scanner-frontend/src/components/UserDashboard/BarcodeScanner.css` — `grep -rn "m-order-item-card" barcode-scanner-frontend/src` to confirm). Append at the bottom of that file:

```css
.m-order-item-group-expanded {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dashed #f0f0f0;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.m-warehouse-subrow {
    padding: 4px 0;
}
```

- [ ] **Step 4: Smoke-test**

Reload the dev server. Add the same product from two warehouses. Click "Expand (2 warehouses)": confirm each warehouse appears with its own qty stepper, you can change qty per row independently, and the "Override price" link reveals an inline input that saves on blur (verify by re-collapsing — the per-warehouse line total reflects the override).

- [ ] **Step 5: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js \
        barcode-scanner-frontend/src/components/UserDashboard/BarcodeScanner.css
git commit -m "feat(cart): expanded view with per-warehouse override

Per-warehouse sub-rows in the expanded view: warehouse tag, qty
stepper bound to update_item, line total, and an Override price input
that writes discounted_price for that single line. Existing per-line
endpoints handle the writes — no new backend surface.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Frontend — wire shared controls + confirm-overwrite modal + bulk-update

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js`

Makes the shared unit/price/discount controls actually call `bulkUpdateOrderItems`. Confirm modal triggers when the corresponding `isMixed*` flag is true.

- [ ] **Step 1: Add the bulk-edit handler**

Inside the `OrderItemGroupCard` body (above the early-return for single-warehouse), add:

```javascript
    const itemIds = group.items.map((i) => i.id);

    const applyBulk = useCallback(async (data, mixedFlag, fieldLabel, formatCurrent, formatNew) => {
        const doApply = async () => {
            const result = await orderService.bulkUpdateOrderItems(orderId, itemIds, data);
            if (result.success) onLocalOrderUpdate(result.data);
            else notify.error(t.orderError, result.error);
        };

        if (mixedFlag) {
            const lines = group.items.map((it) =>
                `${it.warehouse_name}: ${formatCurrent(it)} → ${formatNew}`
            ).join('\n');
            Modal.confirm({
                title: t.confirmOverwriteTitle || 'Apply to all warehouses?',
                content: (
                    <div>
                        <div>{t.confirmOverwriteBody || 'The following warehouses will change:'}</div>
                        <pre style={{fontSize: 12, whiteSpace: 'pre-wrap', marginTop: 6}}>{lines}</pre>
                    </div>
                ),
                okText: t.yes,
                cancelText: t.no,
                onOk: doApply,
            });
            return;
        }
        await doApply();
    }, [group.items, itemIds, orderId, onLocalOrderUpdate, notify, t]);
```

(Move this BELOW the `if (group.items.length === 1)` early return — single-warehouse groups never use it. Or, equivalently, leave it above but read `group.items` once. The single-warehouse case still returns first, so it's never executed there.)

- [ ] **Step 2: Wire the unit Select**

Replace the `disabled` Select from Task 7 with:

```javascript
                <Select
                    value={group.sharedUnit || undefined}
                    size="small"
                    allowClear
                    showSearch
                    placeholder={group.isMixedUnit ? (t.mixed || 'Mixed') : t.unit}
                    className="m-unit-select"
                    options={unitOptions}
                    onChange={(val) => applyBulk(
                        {unit: val || ''},
                        group.isMixedUnit,
                        t.unit,
                        (it) => (it.unit || '—'),
                        (val || '—'),
                    )}
                />
```

- [ ] **Step 3: Wire the shared price input**

Replace the `priceDisplay` block with an editable shared price field. Define the new render below the existing `priceDisplay` declaration:

```javascript
    const handleSharedPriceChange = (val) => {
        if (val == null) return;
        applyBulk(
            {discounted_price: val, discount_percent: 0},
            group.isMixedPrice,
            t.price,
            (it) => `${it.effective_price} ₾`,
            `${val} ₾`,
        );
    };

    const priceArea = (
        <Flex align="center" gap={6}>
            {group.isMixedPrice ? (
                <>
                    <Text type="secondary" style={{fontSize: 12}}>
                        {group.minPrice} ₾ – {group.maxPrice} ₾
                    </Text>
                    <Tag color="orange" style={{fontSize: 10, marginInlineEnd: 0}}>
                        {t.mixed || 'Mixed'}
                    </Tag>
                    <InputNumber
                        size="small"
                        placeholder={t.setPrice}
                        controls={false}
                        addonAfter="₾"
                        onPressEnter={(e) => handleSharedPriceChange(parseFloat(e.target.value))}
                        onBlur={(e) => {
                            const v = parseFloat(e.target.value);
                            if (Number.isFinite(v)) handleSharedPriceChange(v);
                        }}
                        style={{width: 100}}
                    />
                </>
            ) : (
                <InputNumber
                    size="small"
                    value={parseFloat(group.sharedPrice)}
                    controls={false}
                    addonAfter="₾"
                    onPressEnter={(e) => handleSharedPriceChange(parseFloat(e.target.value))}
                    onBlur={(e) => {
                        const v = parseFloat(e.target.value);
                        if (Number.isFinite(v) && v.toFixed(2) !== Number(group.sharedPrice).toFixed(2)) {
                            handleSharedPriceChange(v);
                        }
                    }}
                    style={{width: 100}}
                />
            )}
        </Flex>
    );
```

Use `priceArea` instead of `priceDisplay` in the JSX. (Delete the original `priceDisplay` definition.)

- [ ] **Step 4: Wire the shared discount control**

Replace the placeholder `<Tag>` from Task 7 with the same percent/price-mode toggle as `OrderItemCard`, but driven by `applyBulk`. Insert this where the discount placeholder was:

```javascript
                {canApplyDiscount && maxDiscountPercent > 0 && (
                    <SharedDiscountControl
                        group={group}
                        maxDiscountPercent={maxDiscountPercent}
                        applyBulk={applyBulk}
                        t={t}
                    />
                )}
```

And add the `SharedDiscountControl` component below `WarehouseSubRow`:

```javascript
const SharedDiscountControl = memo(({group, maxDiscountPercent, applyBulk, t}) => {
    const [mode, setMode] = useState(
        group.sharedDiscountedPrice != null ? 'price' : 'percent'
    );
    const sharedPercent = parseFloat(group.sharedDiscountPercent || 0);
    const sharedPrice = group.sharedDiscountedPrice
        ? parseFloat(group.sharedDiscountedPrice)
        : null;

    const onPercentChange = (val) => {
        applyBulk(
            {discount_percent: val || 0, discounted_price: null},
            group.isMixedDiscount,
            t.discount || 'Discount',
            (it) => `${it.discount_percent}%`,
            `${val || 0}%`,
        );
    };
    const onPriceChange = (val) => {
        applyBulk(
            {discounted_price: val ?? null, discount_percent: 0},
            group.isMixedDiscount,
            t.discount || 'Discount',
            (it) => (it.discounted_price ? `${it.discounted_price} ₾` : `${it.discount_percent}%`),
            val == null ? '—' : `${val} ₾`,
        );
    };

    return (
        <Flex align="center" gap={4}>
            <Select
                value={mode}
                onChange={(m) => {
                    setMode(m);
                    if (m === 'percent') onPriceChange(null);
                    else onPercentChange(0);
                }}
                options={[{label: '%', value: 'percent'}, {label: '₾', value: 'price'}]}
                size="small"
                className="m-discount-mode"
            />
            {mode === 'percent' ? (
                <InputNumber
                    min={0}
                    max={Math.min(100, maxDiscountPercent)}
                    value={group.isMixedDiscount ? undefined : sharedPercent}
                    placeholder={group.isMixedDiscount ? (t.mixed || 'Mixed') : undefined}
                    size="small"
                    onChange={onPercentChange}
                    className="m-discount-input"
                    controls={false} inputMode="decimal" addonAfter="%"
                />
            ) : (
                <InputNumber
                    min={0}
                    value={group.isMixedDiscount ? undefined : sharedPrice}
                    placeholder={group.isMixedDiscount ? (t.mixed || 'Mixed') : t.setPrice}
                    size="small"
                    onChange={onPriceChange}
                    className="m-discount-input"
                    controls={false} inputMode="decimal" addonAfter="₾"
                />
            )}
        </Flex>
    );
});

SharedDiscountControl.displayName = 'SharedDiscountControl';
```

- [ ] **Step 5: Smoke-test the full flow**

Restart the dev server. Test:
1. Cart with same SKU in two warehouses, prices differ ($80, $100). Group price area shows `$80 – $100 · Mixed` plus an empty input. Type `$90`, blur → confirm modal lists "WH-A: $80 → $90, WH-B: $100 → $90". Click Yes → both lines update; the modal disappears; the price area now shows the editable `$90` input (no Mixed tag).
2. Type `$95` and blur (no overrides exist) → no modal; both lines update silently.
3. Change shared unit to `box` (groups currently agree on `piece`) → no modal; both lines updated.
4. Apply 10% group discount → no modal; both lines updated.
5. Add per-warehouse override (Task 8 path) → group becomes mixed → next group-level edit triggers the confirm modal again.

- [ ] **Step 6: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js
git commit -m "feat(cart): wire shared controls to bulk-update + confirm modal

Group-level price/unit/discount edits call bulkUpdateOrderItems.
A confirm modal listing affected warehouses appears whenever the
relevant field is currently mixed across the group.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Frontend — inherit-on-add in `handleAddToOrderFromWarehouse`

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js`

When the user adds a SKU at a new warehouse, look up the existing group; if the group is genuinely shared on price/discount/unit, pass those through to `addOrderItem`.

- [ ] **Step 1: Add an inheritance helper**

In `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js`, add an import at the top:

```javascript
import groupItemsBySku from './groupItemsBySku';
```

Add a helper right above `handleAddToOrderFromWarehouse` (around line 440):

```javascript
    const inheritFromExistingGroup = (sku) => {
        const order = activeOrderRef.current;
        if (!order || !Array.isArray(order.items)) return {};
        const groups = groupItemsBySku(order.items);
        const group = groups.find((g) => g.sku === sku);
        if (!group) return {};
        // Only inherit when the group is genuinely shared. Mixed → start fresh
        // at the warehouse's catalog price.
        const inherited = {};
        if (!group.isMixedPrice && group.sharedDiscountedPrice != null) {
            inherited.discounted_price = group.sharedDiscountedPrice;
        }
        if (!group.isMixedDiscount && parseFloat(group.sharedDiscountPercent || 0) > 0) {
            inherited.discount_percent = group.sharedDiscountPercent;
        }
        if (!group.isMixedUnit && group.sharedUnit) {
            inherited.unit = group.sharedUnit;
        }
        // Note: we deliberately don't inherit `price` (the line's catalog
        // price); only the override fields (discounted_price/discount_percent)
        // and unit.
        return inherited;
    };
```

- [ ] **Step 2: Spread inherited fields into the addOrderItem payload**

Modify `handleAddToOrderFromWarehouse` (around line 440) to include the inherited fields:

```javascript
    const handleAddToOrderFromWarehouse = async (warehouseRecord, e) => {
        if (!activeOrder) return;
        if (e?.currentTarget) {
            animateAddToCart(e.currentTarget);
        }
        const inherited = inheritFromExistingGroup(productInfo.sku);
        const addResult = await orderService.addOrderItem(activeOrder.id, {
            sku: productInfo.sku,
            sku_name: productInfo.sku_name || '',
            article: productInfo.article || '',
            price: warehouseRecord.price || 0,
            quantity: 1,
            warehouse_code: warehouseRecord.warehouse || '',
            warehouse_name: warehouseRecord.warehouse_name || '',
            ...inherited,
        });
        if (addResult.success) {
            activeOrderRef.current = addResult.data;
            setActiveOrder(addResult.data);
        } else {
            notify.error(t.orderError, addResult.error);
        }
    };
```

- [ ] **Step 3: Smoke-test inheritance**

1. Add Widget from WH-A. Set group discount to 10%. Cart: WH-A line at 10% off.
2. Open the same Widget at WH-B. Click "Add to order".
3. Confirm: WH-B line in the cart appears with the same 10% discount. Group is *not* mixed.
4. Repeat with a per-warehouse override on WH-A (so group is mixed). Add WH-C. Confirm WH-C lands with no inherited override (uses catalog price).

- [ ] **Step 4: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js
git commit -m "feat(cart): inherit group price/discount/unit on new warehouse

When the user adds a SKU at a new warehouse and the existing group is
genuinely shared on those fields, the new line is created with the
inherited values. Mixed groups create the new line at catalog price.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Frontend — i18n keys

**Files:**
- Modify: `barcode-scanner-frontend/src/i18n/translations.js`

Adds the new keys used in Tasks 7-10. Backend errors use machine-readable `code`s, so no new translations needed there.

- [ ] **Step 1: Add the keys**

In `barcode-scanner-frontend/src/i18n/translations.js`, add inside both `ka` and `en` objects (use the same key names; the existing patterns in the file will guide you on shape):

```javascript
// English
mixed: 'Mixed',
expandWarehouses: 'Expand ({count} warehouses)',
collapse: 'Collapse',
total: 'Total',
warehouses: 'warehouses',
confirmOverwriteTitle: 'Apply to all warehouses?',
confirmOverwriteBody: 'The following warehouses will change:',
overridePrice: 'Override price',
removeFromAllWarehouses: 'Remove product from all warehouses?',
discount: 'Discount',
cancel: 'Cancel',

// Georgian
mixed: 'შერეული',
expandWarehouses: 'გახსნა ({count} საწყობი)',
collapse: 'დახურვა',
total: 'სულ',
warehouses: 'საწყობი',
confirmOverwriteTitle: 'მიიყენოს ყველა საწყობს?',
confirmOverwriteBody: 'შემდეგი საწყობები შეიცვლება:',
overridePrice: 'ფასის გადაფარვა',
removeFromAllWarehouses: 'წაიშალოს ყველა საწყობიდან?',
discount: 'ფასდაკლება',
cancel: 'გაუქმება',
```

`expandWarehouses` is referenced as `${t.expandWarehouses || 'Expand (${group.items.length} warehouses)'}` in `OrderPanel.js`. The `{count}` placeholder in the translation is for documentation only — the implementation uses string concatenation, not interpolation. If you prefer real interpolation, replace the call site with `t.expandWarehouses.replace('{count}', group.items.length)`.

- [ ] **Step 2: Verify the keys load**

Open `http://localhost:3000`, switch language to Georgian, expand a multi-warehouse group, and confirm the labels render in Georgian. Switch back to English; confirm fallback strings disappear.

- [ ] **Step 3: Commit**

```bash
git add barcode-scanner-frontend/src/i18n/translations.js
git commit -m "i18n(cart): keys for grouped-by-SKU cart UI

Adds Georgian + English strings for the multi-warehouse group view:
mixed, expandWarehouses, total, confirmOverwriteTitle, etc.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Manual end-to-end smoke test

**Files:** none (verification only)

Walks through every requirement in the spec against the running stack.

- [ ] **Step 1: Stack up**

```bash
docker-compose up --build -d
```

Open `http://localhost:3000` and log in as a `company_user` with `can_apply_discount=true` and a non-zero `max_discount_percent`.

- [ ] **Step 2: Single-warehouse group parity**

Add a product from one warehouse. Confirm the cart card looks visually identical to before this change: qty stepper, unit Select, price + effective price, discount control, line total — all per-line.

- [ ] **Step 3: Multi-warehouse collapsed view**

Add the same product from two warehouses. Confirm:
- One card per SKU.
- Warehouse name tags visible in the summary row.
- "Total: N <unit>" text instead of qty stepper.
- Single price (when shared) or `$min – $max · Mixed` (when not).
- Shared unit Select.
- Shared discount control (when user has the permission).
- Group-level line total (sum across warehouses).
- Order total at the bottom matches the sum of group line totals.

- [ ] **Step 4: Override semantics — group price**

With the multi-warehouse cart from Step 3, type a new shared price. Both warehouses are at the same price → modal does NOT appear → both lines update.

Now click "Override price" on one warehouse in the expanded view, save a different price → group becomes mixed. Type a new shared price → modal appears listing both warehouses with `current → new` → click Yes → both lines update.

- [ ] **Step 5: Quantity is per-warehouse**

Expand the group. Change qty on WH-A. Confirm WH-A's line total updates and the group line total recomputes; WH-B is untouched.

- [ ] **Step 6: Inherit on new warehouse**

Set group discount to 10%. Open the same product at WH-C. Click Add to order. Confirm WH-C's line carries 10% discount automatically; group is still genuinely shared.

Now apply a per-warehouse override on WH-A. Add the same product at WH-D. Confirm WH-D lands at catalog price (no inheritance, because the group is mixed).

- [ ] **Step 7: Discount permission denial**

Set `max_discount_percent=10` on the user (via admin). With a multi-warehouse cart, try to apply a 50% group discount. Confirm:
- A `DISCOUNT_EXCEEDS_LIMIT`-style error notification appears.
- Neither warehouse's discount changes (rollback works).

- [ ] **Step 8: Delete-the-group**

Click the trash button on a multi-warehouse group. Confirm the popconfirm reads "Remove product from all warehouses?" and confirms remove every line in the group.

- [ ] **Step 9: Single round-trip per group action**

Open the browser network tab. Apply a group price; confirm exactly one `PATCH .../bulk-update/` call (not N parallel `PATCH .../update/` calls).

- [ ] **Step 10: Cleanup**

If any test step failed, capture the failure and fix in code before declaring done. If everything passes, the feature is complete.

---

## Self-Review (do this last, before declaring the plan done)

- **Spec coverage**: every locked requirement (1–6) and every "Edge cases" bullet in the spec maps to a task — collapsed default (T7), override-confirm semantics (T9), per-warehouse qty (T8), mixed-price display (T7), inherit-on-add (T10), single-warehouse parity (T6), discount-denial rollback (T3), cross-org scoping (T3), mixed-units edge (handled implicitly by the same applyBulk path in T9).
- **Placeholder scan**: no `TODO`/`TBD`/"add error handling"/"similar to" left in the steps.
- **Type consistency**: backend payload `{item_ids, data}` matches the frontend `bulkUpdateOrderItems(orderId, itemIds, data)` shape; `groupItemsBySku` exposes `sharedPrice`, `sharedUnit`, `sharedDiscountPercent`, `sharedDiscountedPrice`, `isMixedPrice`, `isMixedDiscount`, `isMixedUnit` and these are the exact names referenced in `OrderItemGroupCard`, `SharedDiscountControl`, and `inheritFromExistingGroup`. Helper file path `./groupItemsBySku` is consistent across imports.
- **No optimistic UI** — every state change waits for the server's refreshed-order response, matching the existing pattern in `OrderPanel.js`.

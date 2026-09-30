# Automatic Discount Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show 1C's automatic discount in the cart and send it as each line's `Discount` on confirm, so the 1C order, our total and the invoice agree.

**Architecture:** A new `PurchaseOrderItem.auto_discount_percent` feeds `effective_price` when no manual discount is set. `core/services/auto_discount.py::apply_auto_discounts` calls 1C `CalculateAutomaticDiscount` (lines pooled per lookup key) and stores the percentages; a preview action runs it for the cart and the confirm runs it fail-closed before the push. The frontend calls the preview, debounced, while the cart is open, behind a per-org switch carried on the login payload.

**Tech Stack:** Django 6 + DRF, httpx, React 18 (CRA), Jest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-30-automatic-discount-design.md`

## Global Constraints

- Backend commands run from `backend/` with `uv run` (bare `python` is the wrong Django).
- Endpoint test classes carry `@override_settings(SECURE_SSL_REDIRECT=False)`; any that decrypt an org password add `FERNET_KEY=_TEST_FERNET_KEY`.
- New test modules are named `test_<resource>.py` inside `core/tests/` or they never run.
- Error responses use `{"code": "...", "detail": "..."}`.
- With `Organization.auto_discount_enabled = False` the CreateOrder payload must be byte-for-byte today's.
- Never hold a DB transaction open across a 1C call (PgBouncer transaction mode).
- Frontend colours only via `var(--if-*)`; no new literal colours.
- A new top-level login key must be threaded through `Login.js` destructure → `AuthContext.login` signature → localStorage write → state restore → `logout()` cleanup.
- Frontend tests run with `npm test -- --watchAll=false <pattern>` from `barcode-scanner-frontend/` (not bare `npx jest`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage by path; other sessions share this checkout.

## Review Focus

1. **1C returns an out-of-range or non-numeric `AutoDiscountPercent`** (e.g. `150`, `-5`, `"abc"`, `null`) — expect it clamped to 0–100 / treated as 0, never a 500 or a negative price. Test in Task 2.
2. **A re-confirm of an already-pushed order** — expect no recalculation (it would rewrite prices 1C has booked). Test in Task 5.
3. **The same product on two warehouse lines** — expect one pooled request item and the same percent on both lines. Test in Task 4.
4. **A preview answer arriving after a newer cart edit** — expect it dropped, not laid over the newer cart. Test in Task 8.
5. **A manual discount explicitly cleared to 0** — expect the automatic percent to apply again (manual replaces auto only when > 0). Test in Task 1.

---

## File map

Backend:
- Modify `backend/core/models.py` — `Organization.auto_discount_enabled`, `PurchaseOrderItem.auto_discount_percent`, `effective_price`.
- Create `backend/core/migrations/0035_auto_discount.py` (generated).
- Modify `backend/core/serializers/orders.py`, `backend/core/serializers/organizations.py`.
- Modify `backend/core/services/consult_web_exchange.py` — `calculate_automatic_discount`, `_to_percent`.
- Modify `backend/core/services/order_push.py` — extract `order_client_id_phone`, `order_stock_id`, `line_lookup_keys`; send auto %.
- Create `backend/core/services/auto_discount.py`.
- Modify `backend/core/views/orders.py` — `auto_discount` action, confirm hook.
- Modify `backend/users/serializers.py` — login key.
- Tests: `core/tests/test_orders.py`, `test_consult_orders.py`, `test_order_push.py`, new `test_auto_discount.py`, `users/tests/test_auth.py`.

Frontend (`barcode-scanner-frontend/src/`):
- Modify `components/Auth/AuthContext.js`, `Login.js`, `AuthContext.test.js`.
- Modify `components/Organization/EditOrganization.js`.
- Modify `utils/offlineOrderQueue.js` (+ test).
- Modify `components/UserDashboard/cartSheetView.js` (+ test), `CartItemRow.js` (+ test).
- Modify `api/endpoints.js`, `api/services/orderService.js`.
- Create `components/UserDashboard/useAutoDiscount.js` (+ test).
- Modify `components/UserDashboard/OrderSheet.js`.
- Modify `i18n/translations.js`.

Docs: `docs/architecture/02-domain-model.md`, `docs/architecture/04-authentication.md`, `CLAUDE.md`.

---

### Task 1: Model fields and the effective-price rule

**Files:**
- Modify: `backend/core/models.py` (Organization near `gift_marking_enabled` ~line 92; `PurchaseOrderItem` ~lines 366-412)
- Modify: `backend/core/serializers/orders.py:8-19`, `backend/core/serializers/organizations.py:69`
- Create: migration via `makemigrations`
- Test: `backend/core/tests/test_orders.py` (append)

**Interfaces:**
- Produces: `Organization.auto_discount_enabled: bool`; `PurchaseOrderItem.auto_discount_percent: Decimal(5,2)`; item serializer field `auto_discount_percent` (read-only); org serializer field `auto_discount_enabled`.

- [ ] **Step 1: Write the failing tests** — append to `core/tests/test_orders.py`:

```python
class EffectivePriceAutoDiscountTests(SimpleTestCase):
    """Manual set-price, then manual percent (> 0), then 1C's automatic
    percent, then the list price."""

    def _item(self, **kw):
        defaults = dict(price=Decimal('10.00'), quantity=2)
        defaults.update(kw)
        return PurchaseOrderItem(**defaults)

    def test_auto_percent_applies_without_manual_discount(self):
        item = self._item(auto_discount_percent=Decimal('10'))
        self.assertEqual(item.effective_price, Decimal('9.00'))
        self.assertEqual(item.line_total, Decimal('18.00'))

    def test_manual_percent_replaces_auto(self):
        item = self._item(discount_percent=Decimal('5'), auto_discount_percent=Decimal('10'))
        self.assertEqual(item.effective_price, Decimal('9.50'))

    def test_manual_set_price_replaces_auto(self):
        item = self._item(discounted_price=Decimal('8.00'), auto_discount_percent=Decimal('10'))
        self.assertEqual(item.effective_price, Decimal('8.00'))

    def test_manual_percent_cleared_to_zero_lets_auto_apply(self):
        item = self._item(discount_percent=Decimal('0'), auto_discount_percent=Decimal('10'))
        self.assertEqual(item.effective_price, Decimal('9.00'))

    def test_no_discount_is_list_price(self):
        self.assertEqual(self._item().effective_price, Decimal('10.00'))


@override_settings(SECURE_SSL_REDIRECT=False)
class AutoDiscountFieldsSerializationTests(TestCase):
    def test_item_serializer_exposes_auto_percent_read_only(self):
        org = _make_organization()
        user = User.objects.create_user(username='u-auto', password='p',
                                        role=User.Role.COMPANY_USER, organization=org)
        order = PurchaseOrder.objects.create(organization=org, created_by=user, customer_name='C')
        item = PurchaseOrderItem.objects.create(order=order, sku='S', price=Decimal('10.00'),
                                                auto_discount_percent=Decimal('10'))
        data = PurchaseOrderItemSerializer(item).data
        self.assertEqual(data['auto_discount_percent'], '10.00')
        self.assertEqual(data['effective_price'], '9.00')
        self.assertIn('auto_discount_percent', PurchaseOrderItemSerializer.Meta.read_only_fields)

    def test_org_switch_defaults_off(self):
        self.assertFalse(_make_organization(name='O2', identification_number='2').auto_discount_enabled)
```

Add any missing imports at the top of the file: `SimpleTestCase` (from `django.test`), `Decimal`, `PurchaseOrderItem`, `PurchaseOrder`, `User`, `PurchaseOrderItemSerializer` (from `core.serializers`).

- [ ] **Step 2: Run to verify failure**

Run: `uv run python manage.py test core.tests.test_orders.EffectivePriceAutoDiscountTests core.tests.test_orders.AutoDiscountFieldsSerializationTests`
Expected: errors — `PurchaseOrderItem() got unexpected keyword 'auto_discount_percent'`.

- [ ] **Step 3: Implement**

In `Organization`, after `gift_marking_enabled`:

```python
    # Automatic discounts from 1C CalculateAutomaticDiscount
    # (core/services/auto_discount.py). Off by default: another org's 1C may
    # not have the endpoint, and a 404 there would block every confirm.
    auto_discount_enabled = models.BooleanField(default=False)
```

In `PurchaseOrderItem`, after `discounted_price`:

```python
    # 1C's automatic discount, written by core/services/auto_discount.py.
    # Applies only when no manual discount is set; never checked against the
    # consultant's max_discount_percent.
    auto_discount_percent = models.DecimalField(max_digits=5, decimal_places=2, default=0)
```

Replace `effective_price`:

```python
    @property
    def effective_price(self):
        """A manual set price, else a manual percent, else 1C's automatic
        percent, else the list price."""
        from decimal import Decimal
        if self.discounted_price is not None:
            return self.discounted_price
        if self.discount_percent and self.discount_percent > 0:
            return self.price * (Decimal('1') - self.discount_percent / Decimal('100'))
        if self.auto_discount_percent and self.auto_discount_percent > 0:
            return self.price * (Decimal('1') - self.auto_discount_percent / Decimal('100'))
        return self.price
```

`core/serializers/orders.py` — `PurchaseOrderItemSerializer.Meta`:

```python
        fields = [
            'id', 'sku', 'sku_name', 'article', 'price', 'quantity',
            'warehouse_code', 'warehouse_name', 'unit',
            'discount_percent', 'discounted_price', 'auto_discount_percent',
            'is_gift', 'effective_price', 'line_total', 'added_at',
        ]
        read_only_fields = ['id', 'added_at', 'line_total', 'effective_price', 'auto_discount_percent']
```

`core/serializers/organizations.py:69`:

```python
            'gift_marking_enabled', 'product_catalog_enabled', 'product_limit',
            'auto_discount_enabled',
```

Check `core/admin.py`: if `OrganizationAdmin` declares `fieldsets` or `fields` that list `gift_marking_enabled`, add `auto_discount_enabled` beside it (at plan time it does not, so the default form already shows it).

Generate the migration: `uv run python manage.py makemigrations core -n auto_discount`. It must contain exactly two `AddField` operations.

- [ ] **Step 4: Run to verify pass**

Run: `uv run python manage.py test core.tests.test_orders`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add backend/core/models.py backend/core/migrations/0035_auto_discount.py backend/core/serializers/orders.py backend/core/serializers/organizations.py backend/core/tests/test_orders.py
git commit -m "feat(orders): auto_discount_percent on order lines and a per-org switch"
```

---

### Task 2: 1C client — `calculate_automatic_discount`

**Files:**
- Modify: `backend/core/services/consult_web_exchange.py` (add after `create_order`, ~line 515; imports at top)
- Test: `backend/core/tests/test_consult_orders.py` (append class)

**Interfaces:**
- Produces: `ConsultWebExchangeClient.calculate_automatic_discount(*, client_id_phone: str, user_id: str, stock_id: str, comment: str = "", items: list[dict]) -> dict` where `items` use keys `is_barcode, sku, quantity, price, cost`, and the result is `{"items": dict[str, Decimal], "document_amount": Decimal|None, "total_discount": Decimal|None, "total_after_discount": Decimal|None, "raw": dict}`. Raises `ConsultWebExchangeError` with code `AUTO_DISCOUNT_REJECTED` (http 400) or the existing transport codes.

- [ ] **Step 1: Write the failing tests** — append to `core/tests/test_consult_orders.py`:

```python
@override_settings(FERNET_KEY=_TEST_FERNET_KEY)
class CalculateAutomaticDiscountClientTests(TestCase):
    def setUp(self):
        self.org = _make_organization()

    @staticmethod
    def _response(status_code, body=None):
        resp = mock.Mock()
        resp.status_code = status_code
        if body is None:
            resp.json.side_effect = ValueError('no json')
            resp.text = ''
        else:
            resp.json.return_value = body
            resp.text = str(body)
        resp.reason_phrase = ''
        return resp

    @staticmethod
    def _body(**overrides):
        body = {
            'success': True, 'message': 'ok',
            'DocumentAmount': 50, 'TotalAutoDiscountAmount': 5, 'TotalAmountAfterDiscount': 45,
            'Items': [{'Sku': 'A 110ST 20', 'ItemCode': '000000015541', 'Quantity': 10,
                       'Price': 5, 'Cost': 50, 'AutoDiscountPercent': 10,
                       'AutoDiscountAmount': 5, 'AmountAfterDiscount': 45}],
        }
        body.update(overrides)
        return body

    def _call(self, response):
        captured = {}

        def fake_request(method, url, **kw):
            captured.update(method=method, url=url, json=kw.get('json'))
            return response

        with mock.patch('httpx.request', side_effect=fake_request):
            result = ConsultWebExchangeClient(self.org).calculate_automatic_discount(
                client_id_phone='123456789', user_id='Administrator', stock_id='000000001',
                comment='Web order #101',
                items=[{'is_barcode': False, 'sku': 'A 110ST 20', 'quantity': 10,
                        'price': Decimal('5.00'), 'cost': Decimal('50.00')}],
            )
        return result, captured

    def test_posts_documented_payload(self):
        _, captured = self._call(self._response(200, self._body()))
        self.assertEqual(captured['method'], 'POST')
        self.assertTrue(captured['url'].endswith('/HS/ConsultWebExchange/CalculateAutomaticDiscount'))
        self.assertEqual(captured['json'], {
            'ClientIDPhone': '123456789', 'UserID': 'Administrator', 'StockID': '000000001',
            'Comment': 'Web order #101',
            'Items': [{'IsBarcode': 'false', 'Sku': 'A 110ST 20', 'Quantity': 10,
                       'Price': 5.0, 'Cost': 50.0}],
        })

    def test_normalizes_percent_by_sku_and_totals(self):
        result, _ = self._call(self._response(200, self._body()))
        self.assertEqual(result['items'], {'A 110ST 20': Decimal('10.00')})
        self.assertEqual(result['document_amount'], Decimal('50'))
        self.assertEqual(result['total_discount'], Decimal('5'))
        self.assertEqual(result['total_after_discount'], Decimal('45'))

    def test_out_of_range_and_garbage_percents_are_clamped(self):
        items = [
            {'Sku': 'HI', 'AutoDiscountPercent': 150},
            {'Sku': 'NEG', 'AutoDiscountPercent': -5},
            {'Sku': 'BAD', 'AutoDiscountPercent': 'abc'},
            {'Sku': 'NONE', 'AutoDiscountPercent': None},
            {'Sku': 'FRAC', 'AutoDiscountPercent': 7.125},
            {'AutoDiscountPercent': 3},  # no Sku: ignored
        ]
        result, _ = self._call(self._response(200, self._body(Items=items)))
        self.assertEqual(result['items'], {
            'HI': Decimal('100.00'), 'NEG': Decimal('0.00'), 'BAD': Decimal('0.00'),
            'NONE': Decimal('0.00'), 'FRAC': Decimal('7.13'),
        })

    def test_success_false_is_rejected_with_upstream_message(self):
        with self.assertRaises(ConsultWebExchangeError) as ctx:
            self._call(self._response(400, {'success': False, 'message': 'ClientIDPhone is required'}))
        self.assertEqual(ctx.exception.code, 'AUTO_DISCOUNT_REJECTED')
        self.assertEqual(ctx.exception.detail, 'ClientIDPhone is required')
        self.assertEqual(ctx.exception.http_status, 400)

    def test_non_json_200_is_external_error(self):
        with self.assertRaises(ConsultWebExchangeError) as ctx:
            self._call(self._response(200))
        self.assertEqual(ctx.exception.code, 'EXTERNAL_SERVICE_ERROR')

    def test_timeout_maps_to_external_timeout(self):
        with mock.patch('httpx.request', side_effect=httpx.ReadTimeout('slow')):
            with self.assertRaises(ConsultWebExchangeError) as ctx:
                ConsultWebExchangeClient(self.org).calculate_automatic_discount(
                    client_id_phone='1', user_id='u', stock_id='s', items=[],
                )
        self.assertEqual(ctx.exception.code, 'EXTERNAL_SERVICE_TIMEOUT')
```

Add `import httpx` at the top of the test module if it is not there.

- [ ] **Step 2: Run to verify failure**

Run: `uv run python manage.py test core.tests.test_consult_orders.CalculateAutomaticDiscountClientTests`
Expected: `AttributeError: ... has no attribute 'calculate_automatic_discount'`.

- [ ] **Step 3: Implement** — in `consult_web_exchange.py`, add to the imports `from decimal import ROUND_HALF_UP, Decimal, InvalidOperation`, then add this method after `create_order`:

```python
    def calculate_automatic_discount(
        self,
        *,
        client_id_phone: str,
        user_id: str,
        stock_id: str,
        comment: str = "",
        items: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """POST /CalculateAutomaticDiscount — 1C's automatic discounts for a
        cart, without creating a document.

        `items` use internal keys (`is_barcode`, `sku`, `quantity`, `price`,
        `cost`). 1C sums its quantity, document-sum and payment-type
        percentages into each row's `AutoDiscountPercent`. Rows are matched
        back by the echoed `Sku`, never by position; a percent outside 0–100
        or unreadable is clamped / read as 0, so a bad upstream value can
        never price a line negative. `ClientIDPhone` is required upstream
        (400 `success: false` without it), which surfaces as
        AUTO_DISCOUNT_REJECTED like any other rejection.
        """
        payload: dict[str, Any] = {
            "ClientIDPhone": client_id_phone,
            "UserID": user_id,
            "StockID": stock_id,
            "Items": [
                {
                    "IsBarcode": "true" if item.get("is_barcode") else "false",
                    "Sku": item["sku"],
                    "Quantity": item["quantity"],
                    "Price": float(item["price"]),
                    "Cost": float(item["cost"]),
                }
                for item in items
            ],
        }
        if comment:
            payload["Comment"] = comment

        response = self._request("POST", "CalculateAutomaticDiscount", json=payload)
        self._check_auth(response, "CalculateAutomaticDiscount")

        try:
            body = response.json()
        except ValueError:
            body = None

        rejected = response.status_code in (400, 404) or (
            isinstance(body, dict) and body.get("success") is False
        )
        if rejected:
            message = body.get("message") if isinstance(body, dict) else None
            logger.warning(
                "ConsultWebExchange CalculateAutomaticDiscount rejected org=%s status=%s body=%s",
                self.organization.id, response.status_code, safe_body(response),
            )
            raise ConsultWebExchangeError(
                code="AUTO_DISCOUNT_REJECTED",
                detail=message or "The organization's web service could not calculate discounts.",
                http_status=400,
                upstream_status=response.status_code,
            )
        if response.status_code != 200 or not isinstance(body, dict):
            logger.error(
                "ConsultWebExchange CalculateAutomaticDiscount unexpected org=%s status=%s body=%s",
                self.organization.id, response.status_code, safe_body(response),
            )
            raise ConsultWebExchangeError(
                code="EXTERNAL_SERVICE_ERROR",
                detail="Unexpected response from the organization's web service.",
                http_status=502,
                upstream_status=response.status_code,
            )

        percents: dict[str, Decimal] = {}
        for row in body.get("Items") or []:
            if isinstance(row, dict) and row.get("Sku"):
                percents.setdefault(str(row["Sku"]), _to_percent(row.get("AutoDiscountPercent")))
        return {
            "items": percents,
            "document_amount": _to_decimal(body.get("DocumentAmount")),
            "total_discount": _to_decimal(body.get("TotalAutoDiscountAmount")),
            "total_after_discount": _to_decimal(body.get("TotalAmountAfterDiscount")),
            "raw": body,
        }
```

And module-level helpers next to `_extract_client_list`:

```python
def _to_decimal(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _to_percent(value: Any) -> Decimal:
    """1C's AutoDiscountPercent as a 0–100 Decimal with 2 places; 0 if unreadable."""
    number = _to_decimal(value)
    if number is None or not number.is_finite():
        number = Decimal(0)
    number = min(max(number, Decimal(0)), Decimal(100))
    return number.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
```

Confirm `safe_body` is already imported in this module (`create_order` uses it).

- [ ] **Step 4: Run to verify pass**

Run: `uv run python manage.py test core.tests.test_consult_orders`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add backend/core/services/consult_web_exchange.py backend/core/tests/test_consult_orders.py
git commit -m "feat(1c): CalculateAutomaticDiscount client method"
```

---

### Task 3: Share the push's order checks and send the auto percent

**Files:**
- Modify: `backend/core/services/order_push.py:179-301`
- Test: `backend/core/tests/test_order_push.py` (add to `CreateOrderOnConfirmTests`)

**Interfaces:**
- Produces (module-level in `order_push.py`):
  - `order_client_id_phone(order) -> str` — first non-blank of ID / phone / org retail counterparty; `""` for a retail order with none; raises `OrderPushError("MISSING_CLIENT")` for a non-retail order with none.
  - `order_stock_id(items) -> str` — raises `MULTIPLE_WAREHOUSES` / `MISSING_WAREHOUSE`.
  - `line_lookup_keys(organization, items) -> dict[int, tuple[str, bool]]` — item id → `(lookup, is_barcode)`; raises `ITEM_LOOKUP_KEY_MISSING` (extra `sku`).
- Push payload: `discount` = `discount_percent` if > 0 else `auto_discount_percent` (set-price branch unchanged).

- [ ] **Step 1: Write the failing tests** — add inside `CreateOrderOnConfirmTests` (the class-level mocks already supply `mstock, mcreate`; these tests also patch the calculation so the confirm hook added in Task 5 does not reach the network — until Task 5 the extra patch is harmless):

```python
    @mock.patch('core.services.consult_web_exchange.ConsultWebExchangeClient.calculate_automatic_discount')
    def test_auto_percent_sent_as_discount_when_no_manual_discount(self, mcalc, mstock, mcreate):
        self._plenty_of_stock(mstock)
        mcreate.return_value = self._success()
        order = self._order()
        self._item(order, qty=2, auto_discount_percent=Decimal('10'))

        self.assertEqual(self._confirm(order).status_code, 200)
        sent = mcreate.call_args.kwargs['items'][0]
        self.assertEqual(sent['price'], Decimal('10.00'))
        self.assertEqual(sent['discount'], Decimal('10'))

    @mock.patch('core.services.consult_web_exchange.ConsultWebExchangeClient.calculate_automatic_discount')
    def test_manual_percent_wins_over_auto_in_payload(self, mcalc, mstock, mcreate):
        self._plenty_of_stock(mstock)
        mcreate.return_value = self._success()
        order = self._order()
        self._item(order, discount_percent=Decimal('5'), auto_discount_percent=Decimal('10'))

        self.assertEqual(self._confirm(order).status_code, 200)
        self.assertEqual(mcreate.call_args.kwargs['items'][0]['discount'], Decimal('5'))

    @mock.patch('core.services.consult_web_exchange.ConsultWebExchangeClient.calculate_automatic_discount')
    def test_set_price_wins_over_auto_in_payload(self, mcalc, mstock, mcreate):
        self._plenty_of_stock(mstock)
        mcreate.return_value = self._success()
        order = self._order()
        self._item(order, discounted_price=Decimal('8.00'), auto_discount_percent=Decimal('10'))

        self.assertEqual(self._confirm(order).status_code, 200)
        sent = mcreate.call_args.kwargs['items'][0]
        self.assertEqual((sent['price'], sent['discount']), (Decimal('8.00'), Decimal(0)))
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run python manage.py test core.tests.test_order_push.CreateOrderOnConfirmTests.test_auto_percent_sent_as_discount_when_no_manual_discount`
Expected: FAIL — `discount` is `Decimal('0.00')`, not `10`.

- [ ] **Step 3: Implement** — in `order_push.py`, add above `push_order_to_consult`:

```python
def order_client_id_phone(order):
    """The 1C ClientIDPhone: ID, else phone, else the org's retail counterparty.

    '' for a retail order with none of the three (CreateOrder then omits the
    key); a customer order with none raises MISSING_CLIENT.
    """
    client_id_phone = (
        order.customer_identification_number
        or order.customer_phone
        or order.organization.retail_client_id_phone
    )
    if not client_id_phone and not order.is_retail:
        # A customer order with no client data is an anomaly — fail
        # loud rather than create a clientless sale in 1C.
        raise OrderPushError(
            "MISSING_CLIENT",
            "Order has no client; only retail orders can confirm without one.",
        )
    return client_id_phone or ""


def order_stock_id(items):
    """The one warehouse every line shares — 1C takes one StockID per order."""
    warehouse_codes = {item.warehouse_code for item in items}
    if len(warehouse_codes) > 1:
        raise OrderPushError(
            "MULTIPLE_WAREHOUSES",
            "1C accepts one warehouse per order; all items must share a warehouse to confirm.",
        )
    stock_id = next(iter(warehouse_codes))
    if not stock_id:
        raise OrderPushError(
            "MISSING_WAREHOUSE",
            "Order items have no warehouse; a warehouse is required to confirm.",
        )
    return stock_id


def line_lookup_keys(organization, items):
    """item id → (1C lookup key, is_barcode): the article, else a replica barcode."""
    barcode_by_sku = replica_barcode_by_sku(
        organization,
        {i.sku for i in items if not i.article and i.sku},
    )
    keys = {}
    for item in items:
        if item.article:
            keys[item.id] = (item.article, False)
        elif barcode_by_sku.get(item.sku):
            keys[item.id] = (barcode_by_sku[item.sku], True)
        else:
            raise OrderPushError(
                "ITEM_LOOKUP_KEY_MISSING",
                f"Item '{item.sku_name or item.sku}' has no article or known barcode to send to 1C.",
                sku=item.sku,
            )
    return keys
```

Then in `push_order_to_consult`, replace the client block (from `client_id_phone = (` through the `logging.info(... "ClientIDPhone omitted" ...)`), the warehouse block, and the lookup loop with:

```python
    client_id_phone = order_client_id_phone(order)
    if not client_id_phone:
        logging.info(
            "CreateOrder push for retail order=%s with no client — "
            "ClientIDPhone omitted", order.id,
        )

    stock_id = order_stock_id(items)
    keys = line_lookup_keys(order.organization, items)
    payload_items = []
    for item in items:
        lookup, is_barcode = keys[item.id]
        # Keep 1C's computed Amount identical to our line_total: an
        # absolute discounted price replaces Price (a derived percent
        # would round); a percent discount — the consultant's, else 1C's
        # automatic one — rides along and 1C applies it to Cost itself.
        # Sending the automatic percent explicitly keeps CreateOrder out
        # of its own automatic branch (Discount = 0, no Warehouses), which
        # knows only the quantity rules and would book a different amount.
        if item.discounted_price is not None:
            price, discount = item.discounted_price, Decimal(0)
        elif item.discount_percent and item.discount_percent > 0:
            price, discount = item.price, item.discount_percent
        else:
            price, discount = item.price, item.auto_discount_percent
        payload_items.append({
            "is_barcode": is_barcode,
            "sku": lookup,
            "quantity": item.quantity,
            "price": price,
            "cost": price * item.quantity,
            "discount": discount,
            # 1C sets the row's `Подарок` from this. Our own mark is
            # informational and never touched effective_price/line_total,
            # so the pricing above is unchanged by it.
            "gift": item.is_gift,
        })
```

The order of checks stays: client, then warehouse, then lookup keys (existing tests pin each error).

- [ ] **Step 4: Run to verify pass**

Run: `uv run python manage.py test core.tests.test_order_push`
Expected: OK — all existing push tests (switch off, `auto_discount_percent` 0) still pass unchanged, which is the "byte-for-byte" constraint.

- [ ] **Step 5: Commit**

```bash
git add backend/core/services/order_push.py backend/core/tests/test_order_push.py
git commit -m "refactor(push): share client/warehouse/lookup checks; send auto percent as Discount"
```

---

### Task 4: `apply_auto_discounts` service

**Files:**
- Create: `backend/core/services/auto_discount.py`
- Test: `backend/core/tests/test_auto_discount.py`

**Interfaces:**
- Consumes: `order_client_id_phone`, `order_stock_id`, `line_lookup_keys`, `order_comment`, `OrderPushError` (Task 3); `calculate_automatic_discount` (Task 2).
- Produces: `apply_auto_discounts(order, *, client=None) -> None`. Raises `OrderPushError` (`AUTO_DISCOUNT_NO_CLIENT`, `MISSING_CLIENT`, `MULTIPLE_WAREHOUSES`, `MISSING_WAREHOUSE`, `ITEM_LOOKUP_KEY_MISSING`) or `ConsultWebExchangeError`. No-op when the org switch is off.

- [ ] **Step 1: Write the failing tests** — `core/tests/test_auto_discount.py`:

```python
from __future__ import annotations

from decimal import Decimal
from unittest import mock

from django.test import TestCase

from core.models import PurchaseOrder, PurchaseOrderItem
from core.services.auto_discount import apply_auto_discounts
from core.services.order_push import OrderPushError
from core.tests.common import _make_organization
from users.models import User


class ApplyAutoDiscountsTests(TestCase):
    """Pools paid lines per 1C lookup key, stores 1C's percent on each line,
    zeroes gifts, and does nothing while the org switch is off."""

    def setUp(self):
        self.org = _make_organization(auto_discount_enabled=True)
        self.user = User.objects.create_user(
            username='auto', password='p', role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.client_mock = mock.Mock()
        self.client_mock.calculate_automatic_discount.return_value = {
            'items': {'A1': Decimal('10.00')}, 'document_amount': None,
            'total_discount': None, 'total_after_discount': None, 'raw': {},
        }

    def _order(self, **extra):
        defaults = dict(organization=self.org, created_by=self.user, customer_name='C',
                        customer_identification_number='01001012345')
        defaults.update(extra)
        return PurchaseOrder.objects.create(**defaults)

    def _item(self, order, *, sku='S1', article='A1', warehouse='W1', qty=1, **extra):
        return PurchaseOrderItem.objects.create(
            order=order, sku=sku, article=article, price=extra.pop('price', Decimal('10.00')),
            quantity=qty, warehouse_code=warehouse, **extra,
        )

    def _run(self, order):
        apply_auto_discounts(order, client=self.client_mock)

    def test_switch_off_is_a_noop_without_calling_1c(self):
        self.org.auto_discount_enabled = False
        self.org.save()
        order = self._order()
        line = self._item(order)
        self._run(order)
        self.client_mock.calculate_automatic_discount.assert_not_called()
        line.refresh_from_db()
        self.assertEqual(line.auto_discount_percent, Decimal('0'))

    def test_request_shape_and_stored_percent(self):
        order = self._order(notes='')
        line = self._item(order, qty=3)
        self._run(order)
        kwargs = self.client_mock.calculate_automatic_discount.call_args.kwargs
        self.assertEqual(kwargs['client_id_phone'], '01001012345')
        self.assertEqual(kwargs['user_id'], self.org.web_service_username)
        self.assertEqual(kwargs['stock_id'], 'W1')
        self.assertEqual(kwargs['comment'], f'Web order #{order.id}')
        self.assertEqual(kwargs['items'], [{
            'is_barcode': False, 'sku': 'A1', 'quantity': 3,
            'price': Decimal('10.00'), 'cost': Decimal('30.00'),
        }])
        line.refresh_from_db()
        self.assertEqual(line.auto_discount_percent, Decimal('10.00'))

    def test_two_lines_of_one_product_are_pooled_and_share_the_percent(self):
        order = self._order()
        first = self._item(order, sku='S1', qty=2)
        second = self._item(order, sku='S1-dup', qty=3)  # same article A1
        self._run(order)
        items = self.client_mock.calculate_automatic_discount.call_args.kwargs['items']
        self.assertEqual(len(items), 1)
        self.assertEqual((items[0]['quantity'], items[0]['cost']), (5, Decimal('50.00')))
        for line in (first, second):
            line.refresh_from_db()
            self.assertEqual(line.auto_discount_percent, Decimal('10.00'))

    def test_gifts_are_not_sent_and_are_zeroed(self):
        order = self._order()
        self._item(order, qty=1)
        gift = self._item(order, sku='G', article='AG', is_gift=True, auto_discount_percent=Decimal('4'))
        self._run(order)
        items = self.client_mock.calculate_automatic_discount.call_args.kwargs['items']
        self.assertEqual([i['sku'] for i in items], ['A1'])
        gift.refresh_from_db()
        self.assertEqual(gift.auto_discount_percent, Decimal('0'))

    def test_key_missing_from_answer_is_reset_to_zero(self):
        order = self._order()
        other = self._item(order, sku='S2', article='A2', auto_discount_percent=Decimal('7'))
        self._item(order)
        self._run(order)
        other.refresh_from_db()
        self.assertEqual(other.auto_discount_percent, Decimal('0'))

    def test_gift_only_order_does_not_call_1c(self):
        order = self._order()
        self._item(order, is_gift=True)
        self._run(order)
        self.client_mock.calculate_automatic_discount.assert_not_called()

    def test_retail_uses_org_counterparty(self):
        self.org.retail_client_id_phone = '555000'
        self.org.save()
        order = self._order(is_retail=True, customer_identification_number='')
        self._item(order)
        self._run(order)
        self.assertEqual(
            self.client_mock.calculate_automatic_discount.call_args.kwargs['client_id_phone'], '555000',
        )

    def test_retail_without_counterparty_raises_no_client(self):
        order = self._order(is_retail=True, customer_identification_number='')
        self._item(order)
        with self.assertRaises(OrderPushError) as ctx:
            self._run(order)
        self.assertEqual(ctx.exception.code, 'AUTO_DISCOUNT_NO_CLIENT')
        self.client_mock.calculate_automatic_discount.assert_not_called()

    def test_mixed_warehouses_raise_before_calling_1c(self):
        order = self._order()
        self._item(order, warehouse='W1')
        self._item(order, sku='S2', article='A2', warehouse='W2')
        with self.assertRaises(OrderPushError) as ctx:
            self._run(order)
        self.assertEqual(ctx.exception.code, 'MULTIPLE_WAREHOUSES')
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run python manage.py test core.tests.test_auto_discount`
Expected: `ModuleNotFoundError: No module named 'core.services.auto_discount'`.

- [ ] **Step 3: Implement** — `core/services/auto_discount.py`:

```python
"""1C automatic discounts for a draft order (CalculateAutomaticDiscount).

The cart's preview action and the confirm both call ``apply_auto_discounts``,
which stores 1C's percent on every paid line. The push then sends that
percent as the line's ``Discount`` (order_push.py), so CreateOrder books
exactly the amount the cart showed. Raises like the push: ``OrderPushError``
for a local guard, ``ConsultWebExchangeError`` for 1C.
"""

from decimal import Decimal

from core.models import PurchaseOrderItem
from core.services.consult_web_exchange import ConsultWebExchangeClient
from core.services.order_push import (
    OrderPushError,
    line_lookup_keys,
    order_client_id_phone,
    order_comment,
    order_stock_id,
)


def apply_auto_discounts(order, *, client=None):
    """Ask 1C for the order's automatic discounts and store them on its lines.

    Paid lines are pooled per 1C lookup key (quantities summed), so one
    product split over two lines still reaches a quantity threshold. Gifts
    are not sent and keep 0. A key 1C does not answer for is reset to 0.
    The lines are written only after 1C answers — no transaction is held
    open across the call.
    """
    organization = order.organization
    if not organization.auto_discount_enabled:
        return
    items = list(order.items.all())
    paid = [item for item in items if not item.is_gift]

    percents = {}
    keys = {}
    if paid:
        client_id_phone = order_client_id_phone(order)
        if not client_id_phone:
            raise OrderPushError(
                "AUTO_DISCOUNT_NO_CLIENT",
                "Automatic discounts need a client; set the organization's retail counterparty.",
            )
        stock_id = order_stock_id(items)
        keys = line_lookup_keys(organization, paid)
        pooled = {}
        for item in paid:
            entry = pooled.setdefault(keys[item.id], {"quantity": 0, "price": item.price})
            entry["quantity"] += item.quantity
        request_items = [
            {
                "is_barcode": is_barcode,
                "sku": lookup,
                "quantity": entry["quantity"],
                "price": entry["price"],
                "cost": entry["price"] * entry["quantity"],
            }
            for (lookup, is_barcode), entry in pooled.items()
        ]
        result = (client or ConsultWebExchangeClient(organization)).calculate_automatic_discount(
            client_id_phone=client_id_phone,
            user_id=organization.web_service_username or "",
            stock_id=stock_id,
            comment=order_comment(order),
            items=request_items,
        )
        percents = result["items"]

    changed = []
    for item in items:
        percent = Decimal(0) if item.is_gift else percents.get(keys[item.id][0], Decimal(0))
        if item.auto_discount_percent != percent:
            item.auto_discount_percent = percent
            changed.append(item)
    if changed:
        PurchaseOrderItem.objects.bulk_update(changed, ["auto_discount_percent"])
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run python manage.py test core.tests.test_auto_discount`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add backend/core/services/auto_discount.py backend/core/tests/test_auto_discount.py
git commit -m "feat(orders): apply_auto_discounts pools lines and stores 1C's percent"
```

---

### Task 5: Preview action and fail-closed confirm

**Files:**
- Modify: `backend/core/views/orders.py` (imports; `@extend_schema_view` ~line 144; `update` ~lines 297-311; new action after `remove_item`)
- Test: `backend/core/tests/test_auto_discount.py` (append view classes)

**Interfaces:**
- Consumes: `apply_auto_discounts` (Task 4).
- Produces: `POST /api/v1/orders/{id}/auto-discount/` → 200 order JSON; 400 `ORDER_NOT_DRAFT`; `OrderPushError` → `{code, detail, **extra}`; `ConsultWebExchangeError` → shared envelope.

- [ ] **Step 1: Write the failing tests** — append to `core/tests/test_auto_discount.py` (add imports `from django.test import override_settings`, `from rest_framework.test import APIClient`, `from core.services.consult_web_exchange import ConsultWebExchangeError`):

```python
CALC = 'core.services.consult_web_exchange.ConsultWebExchangeClient.calculate_automatic_discount'
CREATE = 'core.services.consult_web_exchange.ConsultWebExchangeClient.create_order'
STOCK = 'core.services.consult_web_exchange.ConsultWebExchangeClient.get_stock_and_prices'


def _calc_answer(percent='10.00', sku='A1'):
    return {'items': {sku: Decimal(percent)}, 'document_amount': None,
            'total_discount': None, 'total_after_discount': None, 'raw': {}}


@override_settings(SECURE_SSL_REDIRECT=False)
class AutoDiscountPreviewEndpointTests(TestCase):
    def setUp(self):
        self.org = _make_organization(auto_discount_enabled=True)
        self.user = User.objects.create_user(
            username='prev', password='p', role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.api = APIClient()
        self.api.force_authenticate(self.user)
        self.order = PurchaseOrder.objects.create(
            organization=self.org, created_by=self.user, customer_name='C',
            customer_identification_number='01001012345',
        )
        PurchaseOrderItem.objects.create(order=self.order, sku='S1', article='A1',
                                         price=Decimal('10.00'), quantity=2, warehouse_code='W1')

    def _post(self, order=None):
        return self.api.post(f'/api/v1/orders/{(order or self.order).id}/auto-discount/')

    @mock.patch(CALC, return_value=_calc_answer())
    def test_returns_order_with_auto_percent_and_discounted_total(self, mcalc):
        r = self._post()
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data['items'][0]['auto_discount_percent'], '10.00')
        self.assertEqual(str(r.data['total']), '18.00')

    @mock.patch(CALC)
    def test_other_org_order_is_404(self, mcalc):
        other = _make_organization(name='Other', identification_number='999', auto_discount_enabled=True)
        other_user = User.objects.create_user(username='o', password='p',
                                              role=User.Role.COMPANY_USER, organization=other)
        foreign = PurchaseOrder.objects.create(organization=other, created_by=other_user, customer_name='X')
        self.assertEqual(self._post(foreign).status_code, 404)
        mcalc.assert_not_called()

    @mock.patch(CALC)
    def test_non_draft_is_refused(self, mcalc):
        self.order.status = PurchaseOrder.Status.CONFIRMED
        self.order.save()
        r = self._post()
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data['code'], 'ORDER_NOT_DRAFT')
        mcalc.assert_not_called()

    @mock.patch(CALC, side_effect=ConsultWebExchangeError(
        code='EXTERNAL_SERVICE_TIMEOUT', detail='slow', http_status=504))
    def test_1c_failure_keeps_stored_percent(self, mcalc):
        self.order.items.update(auto_discount_percent=Decimal('5'))
        r = self._post()
        self.assertEqual(r.data['code'], 'EXTERNAL_SERVICE_TIMEOUT')
        self.assertEqual(self.order.items.get().auto_discount_percent, Decimal('5.00'))


@override_settings(SECURE_SSL_REDIRECT=False)
@mock.patch(CREATE, return_value={'success': True, 'OrderNumber': '0001'})
@mock.patch(STOCK, return_value={'stock': [{'warehouse': 'W1', 'quantity': 999}]})
class ConfirmAppliesAutoDiscountTests(TestCase):
    def setUp(self):
        self.org = _make_organization(auto_discount_enabled=True)
        self.user = User.objects.create_user(
            username='conf', password='p', role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.api = APIClient()
        self.api.force_authenticate(self.user)
        self.order = PurchaseOrder.objects.create(
            organization=self.org, created_by=self.user, customer_name='C',
            customer_identification_number='01001012345',
        )
        PurchaseOrderItem.objects.create(order=self.order, sku='S1', article='A1',
                                         price=Decimal('10.00'), quantity=2, warehouse_code='W1')

    def _confirm(self):
        return self.api.patch(f'/api/v1/orders/{self.order.id}/', {'status': 'confirmed'}, format='json')

    @mock.patch(CALC, return_value=_calc_answer('10.00'))
    def test_confirm_recalculates_and_sends_percent(self, mcalc, mstock, mcreate):
        self.assertEqual(self._confirm().status_code, 200)
        mcalc.assert_called_once()
        self.assertEqual(mcreate.call_args.kwargs['items'][0]['discount'], Decimal('10.00'))

    @mock.patch(CALC, side_effect=ConsultWebExchangeError(
        code='AUTO_DISCOUNT_REJECTED', detail='no', http_status=400))
    def test_calculation_failure_blocks_confirm(self, mcalc, mstock, mcreate):
        r = self._confirm()
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data['code'], 'AUTO_DISCOUNT_REJECTED')
        mcreate.assert_not_called()
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, PurchaseOrder.Status.DRAFT)

    @mock.patch(CALC)
    def test_already_pushed_order_is_not_recalculated(self, mcalc, mstock, mcreate):
        self.order.external_order_number = '0001'
        self.order.save()
        self._confirm()
        mcalc.assert_not_called()

    @mock.patch(CALC)
    def test_switch_off_confirms_without_calculation(self, mcalc, mstock, mcreate):
        self.org.auto_discount_enabled = False
        self.org.save()
        self.assertEqual(self._confirm().status_code, 200)
        mcalc.assert_not_called()
        self.assertEqual(mcreate.call_args.kwargs['items'][0]['discount'], Decimal('0'))
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run python manage.py test core.tests.test_auto_discount`
Expected: preview tests 404 (no route); `test_confirm_recalculates_and_sends_percent` fails (`mcalc` not called).

- [ ] **Step 3: Implement** — in `core/views/orders.py`:

Import: `from core.services.auto_discount import apply_auto_discounts`.

In `@extend_schema_view(...)` add:

```python
    auto_discount=extend_schema(
        tags=['Purchase Orders'], request=None, responses=PurchaseOrderSerializer,
    ),
```

In `update`, replace the `try: push_order_to_consult(order)` block with:

```python
                try:
                    # Recalculated here, not trusted from the cart's last
                    # preview: quantities may have changed since. Fail
                    # closed like the push, and never for an order 1C has
                    # already booked (re-confirms skip the push).
                    if not order.external_order_number:
                        apply_auto_discounts(order)
                    push_order_to_consult(order)
                except ConsultWebExchangeError as exc:
                    return external_error_response(exc)
                except OrderPushError as exc:
                    return Response(
                        {"code": exc.code, "detail": exc.detail, **exc.extra},
                        status=exc.http_status,
                    )
```

New action after `remove_item`:

```python
    @action(detail=True, methods=['post'], url_path='auto-discount')
    def auto_discount(self, request, pk=None):
        """Recalculate 1C's automatic discounts for a draft and return the order."""
        order = self.get_object()
        if order.status != PurchaseOrder.Status.DRAFT:
            # A confirmed order's prices are booked in 1C; recalculating
            # would change our total under it.
            return Response(
                {"code": "ORDER_NOT_DRAFT", "detail": "Only a draft order's discounts can be recalculated."},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        try:
            apply_auto_discounts(order)
        except ConsultWebExchangeError as exc:
            return external_error_response(exc)
        except OrderPushError as exc:
            return Response(
                {"code": exc.code, "detail": exc.detail, **exc.extra},
                status=exc.http_status,
            )
        order.refresh_from_db()
        try:
            del order._prefetched_objects_cache
        except AttributeError:
            pass
        return Response(PurchaseOrderSerializer(order).data)
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run python manage.py test core`
Expected: OK (whole app — confirm-path tests in `test_order_push.py` run with the switch off and must not call 1C).

- [ ] **Step 5: Tenancy review** — dispatch the `tenancy-reviewer` agent on `backend/core/views/orders.py` (new action) and fix anything it confirms.

- [ ] **Step 6: Commit**

```bash
git add backend/core/views/orders.py backend/core/tests/test_auto_discount.py
git commit -m "feat(orders): auto-discount preview action; confirm recalculates fail-closed"
```

---

### Task 6: Login flag and org switch UI

**Files:**
- Modify: `backend/users/serializers.py:~177`, `backend/users/tests/test_auth.py`
- Modify: `barcode-scanner-frontend/src/components/Auth/AuthContext.js`, `Login.js:50,55`, `AuthContext.test.js`
- Modify: `barcode-scanner-frontend/src/components/Organization/EditOrganization.js` (after the gift `Form.Item`)
- Modify: `barcode-scanner-frontend/src/i18n/translations.js` (ka near line 215, en near line 969)

**Interfaces:**
- Produces: login payload key `auto_discount_enabled: bool`; `authData.auto_discount_enabled: boolean`; `AuthContext.login(..., gift_marking_enabled, product_catalog_enabled, auto_discount_enabled)` (10th positional arg); i18n `autoDiscountEnabled`, `autoDiscountHint`.

- [ ] **Step 1: Write the failing tests**

`users/tests/test_auth.py`, append:

```python
@override_settings(SECURE_SSL_REDIRECT=False)
class LoginAutoDiscountFlagTests(TestCase):
    def _login(self, username):
        return APIClient().post('/api/v1/users/auth/login/',
                                {'username': username, 'password': 'pw12345'}, format='json')

    def test_flag_mirrors_the_org_switch(self):
        for enabled in (True, False):
            org = Organization.objects.create(
                name=f'AD{enabled}', identification_number=f'77{int(enabled)}',
                employees_count=5, auto_discount_enabled=enabled,
            )
            User.objects.create_user(username=f'ad-{enabled}', password='pw12345',
                                     role=User.Role.COMPANY_USER, organization=org)
            response = self._login(f'ad-{enabled}')
            self.assertEqual(response.status_code, 200, response.data)
            self.assertIs(response.data['auto_discount_enabled'], enabled)

    def test_false_without_org(self):
        User.objects.create_user(username='ad-root', password='pw12345',
                                 role=User.Role.INTERNAL_ADMIN, is_staff=True, is_superuser=True)
        self.assertIs(self._login('ad-root').data['auto_discount_enabled'], False)
```

(Import `Organization` from `core.models` if the module does not already.)

`AuthContext.test.js`: in `Probe`, add `<span data-testid="auto">{String(authData?.auto_discount_enabled)}</span>` and change the login call's last args to `true, true, true`. Add:

```js
  it('carries auto_discount_enabled through login, refresh and logout', () => {
    const {unmount} = render(<AuthProvider><Probe/></AuthProvider>);
    act(() => screen.getByText('login').click());
    expect(screen.getByTestId('auto')).toHaveTextContent('true');
    expect(localStorage.getItem('auto_discount_enabled')).toBe('true');
    unmount();
    render(<AuthProvider><Probe/></AuthProvider>);
    expect(screen.getByTestId('auto')).toHaveTextContent('true');
    act(() => screen.getByText('logout').click());
    expect(localStorage.getItem('auto_discount_enabled')).toBeNull();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run python manage.py test users.tests.test_auth.LoginAutoDiscountFlagTests` → KeyError `auto_discount_enabled`.
Run (from `barcode-scanner-frontend/`): `npm test -- --watchAll=false AuthContext` → new test fails.

- [ ] **Step 3: Implement**

`users/serializers.py`, after `product_catalog_enabled`:

```python
        data['auto_discount_enabled'] = bool(
            self.user.organization
            and self.user.organization.auto_discount_enabled
        )
```

`AuthContext.js` — five places:
1. state init: `const auto_discount_enabled = localStorage.getItem('auto_discount_enabled') === 'true';` and add `auto_discount_enabled` to the returned object;
2. `logout`: `localStorage.removeItem('auto_discount_enabled');`
3. `login` signature: append `, auto_discount_enabled`;
4. in `login`: `const autoDiscountEnabled = auto_discount_enabled === true;` and `localStorage.setItem('auto_discount_enabled', String(autoDiscountEnabled));`
5. `setAuthData({... , auto_discount_enabled: autoDiscountEnabled})`.

`Login.js`: add `auto_discount_enabled` to the destructure (line 50) and as the last `login(...)` argument (line 55).

`EditOrganization.js`, directly after the gift-marking `Form.Item`:

```jsx
            <Form.Item
                label={t.autoDiscountEnabled}
                name="auto_discount_enabled"
                valuePropName="checked"
                extra={<span style={{fontSize: 12, opacity: 0.5}}>{t.autoDiscountHint}</span>}
            >
                <Switch/>
            </Form.Item>
```

`translations.js` — ka, beside `giftMarkingHint`:

```js
        autoDiscountEnabled: 'ავტომატური ფასდაკლება 1C-დან',
        autoDiscountHint: 'კალათა აჩვენებს 1C-ის ავტომატურ ფასდაკლებას და შეკვეთა მისით დადასტურდება. საცალო შეკვეთებს სჭირდება საცალო კონტრაგენტი.',
```

en, beside `giftMarkingHint`:

```js
        autoDiscountEnabled: 'Automatic discount from 1C',
        autoDiscountHint: "The cart shows 1C's automatic discount and orders confirm with it. Retail orders need the retail counterparty set.",
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run python manage.py test users` and `npm test -- --watchAll=false AuthContext EditOrganization translations`
Expected: both green.

- [ ] **Step 5: Commit**

```bash
git add backend/users/serializers.py backend/users/tests/test_auth.py barcode-scanner-frontend/src/components/Auth barcode-scanner-frontend/src/components/Organization/EditOrganization.js barcode-scanner-frontend/src/i18n/translations.js
git commit -m "feat(auth): auto_discount_enabled on the login payload and org settings"
```

---

### Task 7: Cart display — auto tag, discount total, offline price rule

**Files:**
- Modify: `barcode-scanner-frontend/src/utils/offlineOrderQueue.js:~390` (+ `offlineOrderQueue.test.js`)
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/cartSheetView.js` (+ `cartSheetView.test.js`)
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/CartItemRow.js:~116` (+ `CartItemRow.test.js`)
- Modify: `barcode-scanner-frontend/src/i18n/translations.js`

**Interfaces:**
- Produces: `cartRowView(row).autoDiscountPercent: number` (0 when a manual discount is set); `orderDiscountTotal(items) -> string` (2-decimals, ≥ 0); i18n `autoDiscountTag(n)`, `autoDiscountUnavailable`, `discountTotal`.

- [ ] **Step 1: Write the failing tests**

`offlineOrderQueue.test.js`:

```js
describe('applyOpToSnapshot with an automatic discount', () => {
    const order = {id: 42, items: [{
        id: 7, sku: 'A1', price: '10.00', quantity: 2, discount_percent: '0.00',
        discounted_price: null, auto_discount_percent: '10.00',
        effective_price: '9.00', line_total: '18.00',
    }]};

    it('prices a quantity change with the stored automatic percent', () => {
        const next = applyOpToSnapshot(order, {type: 'update_item', itemId: 7, payload: {quantity: 3}});
        expect(next.items[0]).toMatchObject({effective_price: '9.00', line_total: '27.00'});
        expect(next.total).toBe('27.00');
    });

    it('lets a manual percent replace the automatic one', () => {
        const next = applyOpToSnapshot(order, {type: 'update_item', itemId: 7, payload: {discount_percent: 5}});
        expect(next.items[0].effective_price).toBe('9.50');
    });
});
```

(Import `applyOpToSnapshot` if the file does not already.)

`cartSheetView.test.js`:

```js
describe('automatic discount display', () => {
    const line = (extra) => ({id: 1, sku: 'S', price: '10.00', quantity: 2,
        discount_percent: '0.00', discounted_price: null, auto_discount_percent: '10.00',
        effective_price: '9.00', line_total: '18.00', ...extra});

    it('shows the automatic percent when no manual discount is set', () => {
        expect(cartRowView({paid: line(), gift: null, giftQty: 0}).autoDiscountPercent).toBe(10);
    });

    it('hides it behind a manual percent or set price', () => {
        expect(cartRowView({paid: line({discount_percent: '5.00', effective_price: '9.50'}), gift: null, giftQty: 0})
            .autoDiscountPercent).toBe(0);
        expect(cartRowView({paid: line({discounted_price: '8.00', effective_price: '8.00'}), gift: null, giftQty: 0})
            .autoDiscountPercent).toBe(0);
    });

    it('totals the discount across lines, gifts adding nothing', () => {
        expect(orderDiscountTotal([
            line(),
            {id: 2, price: '5.00', quantity: 1, line_total: '5.00', is_gift: true},
        ])).toBe('2.00');
        expect(orderDiscountTotal([])).toBe('0.00');
    });
});
```

(Add `orderDiscountTotal` to the import from `./cartSheetView`.)

`CartItemRow.test.js` — follow the file's existing render helper; add a case rendering a row whose paid line is `line()` above and assert `screen.getByText(/−10% auto/)` exists (en), and one with `discount_percent: '5.00'` asserting `queryByText(/auto/)` is null.

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --watchAll=false offlineOrderQueue cartSheetView CartItemRow`
Expected: new cases fail (`line_total` '30.00'; `autoDiscountPercent` undefined; `orderDiscountTotal` not a function).

- [ ] **Step 3: Implement**

`offlineOrderQueue.js` — replace `effectivePrice` and its comment:

```js
// PurchaseOrderItem.effective_price (core/models.py): a set price wins, then
// a manual percent, then 1C's automatic percent, then the list price.
const effectivePrice = (item) => {
    if (item.discounted_price != null && item.discounted_price !== '') return Number(item.discounted_price) || 0;
    const price = Number(item.price) || 0;
    const percent = Number(item.discount_percent) || 0;
    if (percent > 0) return price * (1 - percent / 100);
    const auto = Number(item.auto_discount_percent) || 0;
    return auto > 0 ? price * (1 - auto / 100) : price;
};
```

`cartSheetView.js` — in `cartRowView`'s returned object, after `discountPercent`:

```js
        // 1C's automatic discount shows only where no manual one replaces it.
        autoDiscountPercent: anchor.discounted_price == null && !(parseFloat(anchor.discount_percent) > 0)
            ? parseFloat(anchor.auto_discount_percent || 0)
            : 0,
```

and a new export:

```js
/** What every discount takes off the cart: Σ(list price × qty) − Σ line_total. */
export const orderDiscountTotal = (items) => Math.max(0, (items || []).reduce(
    (sum, i) => sum + (Number(i.price) || 0) * (Number(i.quantity) || 0) - (Number(i.line_total) || 0),
    0,
)).toFixed(2);
```

`CartItemRow.js` `priceText`, after the `discountPercent` line:

```jsx
            {view.autoDiscountPercent > 0 && ` · ${t.autoDiscountTag(view.autoDiscountPercent)}`}
```

`translations.js` — ka:

```js
        autoDiscountTag: (n) => `−${n}% ავტო`,
        autoDiscountUnavailable: 'ავტომატური ფასდაკლება ვერ გამოითვალა — ნაჩვენები ფასები შესაძლოა არ იყოს საბოლოო',
        discountTotal: 'ფასდაკლება',
```

en:

```js
        autoDiscountTag: (n) => `−${n}% auto`,
        autoDiscountUnavailable: 'Automatic discount could not be calculated — the prices shown may not be final',
        discountTotal: 'Discount',
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- --watchAll=false offlineOrderQueue cartSheetView CartItemRow translations`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add barcode-scanner-frontend/src/utils/offlineOrderQueue.js barcode-scanner-frontend/src/utils/offlineOrderQueue.test.js barcode-scanner-frontend/src/components/UserDashboard/cartSheetView.js barcode-scanner-frontend/src/components/UserDashboard/cartSheetView.test.js barcode-scanner-frontend/src/components/UserDashboard/CartItemRow.js barcode-scanner-frontend/src/components/UserDashboard/CartItemRow.test.js barcode-scanner-frontend/src/i18n/translations.js
git commit -m "feat(cart): show 1C's automatic discount and the cart's discount total"
```

---

### Task 8: Debounced preview in the open cart

**Files:**
- Modify: `barcode-scanner-frontend/src/api/endpoints.js:~43`, `api/services/orderService.js` (after `bulkUpdateOrderItems`)
- Create: `barcode-scanner-frontend/src/components/UserDashboard/useAutoDiscount.js`, `useAutoDiscount.test.js`
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/OrderSheet.js` (hook near `useSkuStock` line 177; notice near line 299; `bottomBar` ~line 222)

**Interfaces:**
- Consumes: `orderDiscountTotal`, i18n keys (Task 7); `authData.auto_discount_enabled` (Task 6); endpoint (Task 5).
- Produces: `API_ENDPOINTS.order_auto_discount(orderId)`; `orderService.autoDiscount(orderId) -> Promise<{success, data, stale?}>`; `useAutoDiscount({order, active, enabled, onOrder, delayMs}) -> {unavailable: boolean}`; `AUTO_DISCOUNT_DEBOUNCE_MS = 800`.

- [ ] **Step 1: Write the failing tests** — `useAutoDiscount.test.js`:

```js
import {act, renderHook} from '@testing-library/react';
import useAutoDiscount from './useAutoDiscount';
import {orderService} from '../../api';

jest.mock('../../api', () => ({orderService: {autoDiscount: jest.fn()}}));

const order = (items, extra = {}) => ({id: 5, status: 'draft', items, ...extra});
const line = (extra = {}) => ({id: 1, sku: 'S', quantity: 1, price: '10.00', ...extra});
const answer = (data) => ({success: true, data});

beforeEach(() => {
    jest.useFakeTimers();
    orderService.autoDiscount.mockReset();
});
afterEach(() => jest.useRealTimers());

const flush = async () => {
    await act(async () => { jest.advanceTimersByTime(800); });
    await act(async () => {});
};

it('asks once after the debounce and hands back the order', async () => {
    const onOrder = jest.fn();
    const fresh = order([line({auto_discount_percent: '10.00'})]);
    orderService.autoDiscount.mockResolvedValue(answer(fresh));
    renderHook(() => useAutoDiscount({order: order([line()]), active: true, enabled: true, onOrder}));
    await flush();
    expect(orderService.autoDiscount).toHaveBeenCalledWith(5);
    expect(onOrder).toHaveBeenCalledWith(fresh);
});

it('does not re-ask when only the auto percent changed', async () => {
    const onOrder = jest.fn();
    orderService.autoDiscount.mockResolvedValue(answer(order([line({auto_discount_percent: '10.00'})])));
    const {rerender} = renderHook((props) => useAutoDiscount(props),
        {initialProps: {order: order([line()]), active: true, enabled: true, onOrder}});
    await flush();
    rerender({order: order([line({auto_discount_percent: '10.00'})]), active: true, enabled: true, onOrder});
    await flush();
    expect(orderService.autoDiscount).toHaveBeenCalledTimes(1);
});

it('drops an answer that a newer cart edit overtook', async () => {
    const onOrder = jest.fn();
    let resolveFirst;
    orderService.autoDiscount
        .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
        .mockResolvedValueOnce(answer(order([line({quantity: 2, auto_discount_percent: '10.00'})])));
    const {rerender} = renderHook((props) => useAutoDiscount(props),
        {initialProps: {order: order([line()]), active: true, enabled: true, onOrder}});
    await flush();
    rerender({order: order([line({quantity: 2})]), active: true, enabled: true, onOrder});
    await act(async () => resolveFirst(answer(order([line({auto_discount_percent: '5.00'})]))));
    await flush();
    expect(onOrder).toHaveBeenCalledTimes(1);
    expect(onOrder.mock.calls[0][0].items[0].quantity).toBe(2);
});

it('ignores a stale answer from the service', async () => {
    const onOrder = jest.fn();
    orderService.autoDiscount.mockResolvedValue({success: true, data: order([line()]), stale: true});
    renderHook(() => useAutoDiscount({order: order([line()]), active: true, enabled: true, onOrder}));
    await flush();
    expect(onOrder).not.toHaveBeenCalled();
});

it('reports unavailable on failure', async () => {
    orderService.autoDiscount.mockResolvedValue({success: false, status: 504});
    const {result} = renderHook(() => useAutoDiscount(
        {order: order([line()]), active: true, enabled: true, onOrder: jest.fn()}));
    await flush();
    expect(result.current.unavailable).toBe(true);
});

it.each([
    ['disabled', {enabled: false}],
    ['closed', {active: false}],
    ['not a draft', {order: order([line()], {status: 'confirmed'})}],
    ['holding a pending line', {order: order([line({id: 'tmp_x'})])}],
    ['empty', {order: order([])}],
])('never asks when %s', async (_, override) => {
    renderHook(() => useAutoDiscount({order: order([line()]), active: true, enabled: true,
        onOrder: jest.fn(), ...override}));
    await flush();
    expect(orderService.autoDiscount).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --watchAll=false useAutoDiscount`
Expected: `Cannot find module './useAutoDiscount'`.

- [ ] **Step 3: Implement**

`endpoints.js`, after `order_items_bulk_update`:

```js
    order_auto_discount: orderId => `api/v1/orders/${orderId}/auto-discount/`,
```

`orderService.js`, after `bulkUpdateOrderItems`:

```js
/**
 * Recalculate 1C's automatic discounts for a draft and answer the order.
 * It writes the lines' auto_discount_percent, so it counts as a write; an
 * answer another write to the order overlapped may predate that write and
 * comes back `stale: true`, unsaved — the overlapping edit's own answer, and
 * the preview it triggers, are the newer word.
 * @param {number} orderId
 */
export const autoDiscount = async (orderId) => {
    const result = await write(orderId, () => api.post(API_ENDPOINTS.order_auto_discount(orderId)));
    if (result.overlapped) return {...result, stale: true};
    return trackSuccess(orderId, result);
};
```

`useAutoDiscount.js`:

```js
import {useEffect, useRef, useState} from 'react';
import {orderService} from '../../api';
import {isTempId} from '../../utils/offlineOrderQueue';

export const AUTO_DISCOUNT_DEBOUNCE_MS = 800;

// What 1C's answer depends on. auto_discount_percent is left out on purpose:
// the answer itself changes it, and including it would ask again forever.
const cartSignature = (items) => (items || []).map((i) => [
    i.id, i.sku, i.article, i.quantity, i.price, i.discount_percent,
    i.discounted_price, i.is_gift, i.warehouse_code,
].join('|')).join(';');

/**
 * 1C's automatic discount for the open cart (core/services/auto_discount.py):
 * one request per burst of edits, AUTO_DISCOUNT_DEBOUNCE_MS after the last.
 * Only for a draft whose lines are all on the server (a tmp_ line is not),
 * and only while the sheet is open and the org has the switch on. An answer
 * a newer edit overtook, or that orderService marks stale, is dropped — the
 * newer edit asks again. The confirm recalculates on the server regardless,
 * so a dropped or failed preview can never mis-price an order.
 *
 * Returns `{unavailable}`: the last request failed, so the prices shown may
 * be missing 1C's discount.
 */
const useAutoDiscount = ({order, active, enabled, onOrder, delayMs = AUTO_DISCOUNT_DEBOUNCE_MS}) => {
    const [unavailable, setUnavailable] = useState(false);
    const onOrderRef = useRef(onOrder);
    onOrderRef.current = onOrder;
    const ticketRef = useRef(0);

    const items = order?.items || [];
    const signature = cartSignature(items);
    const orderId = order?.id;
    const eligible = Boolean(active && enabled && orderId && order?.status === 'draft'
        && items.length > 0 && !items.some((i) => isTempId(i.id) || i._pending));

    useEffect(() => {
        if (!active) setUnavailable(false);
    }, [active]);

    useEffect(() => {
        const ticket = ++ticketRef.current;
        if (!eligible) return undefined;
        const timer = setTimeout(async () => {
            const result = await orderService.autoDiscount(orderId);
            if (ticket !== ticketRef.current || result.stale) return;
            if (result.success) {
                setUnavailable(false);
                onOrderRef.current(result.data);
            } else {
                setUnavailable(true);
            }
        }, delayMs);
        return () => clearTimeout(timer);
    }, [eligible, orderId, signature, delayMs]);

    return {unavailable};
};

export default useAutoDiscount;
```

`OrderSheet.js`:
- import `useAutoDiscount from './useAutoDiscount'` and add `orderDiscountTotal` to the `./cartSheetView` import;
- after the `useSkuStock` line (hooks must stay above `if (!localOrder) return null`):

```js
    // A preview answer is the server's order like any edit's, but it arrives
    // on its own schedule: while a cart field is being typed it is held like
    // an outside order (the ref still learns it), so it cannot remount the
    // row under the consultant's fingers.
    const takeAutoDiscount = useCallback((next) => {
        if (isCartField(cartRef.current, document.activeElement)) {
            heldOrderRef.current = next;
            ownOrderRef.current = next;
            if (onOrderUpdateRef.current) onOrderUpdateRef.current(next);
            return;
        }
        handleLocalOrderUpdate(next);
    }, [handleLocalOrderUpdate]);
    const {unavailable: autoDiscountUnavailable} = useAutoDiscount({
        order: localOrder,
        active: open,
        enabled: !!authData?.auto_discount_enabled,
        onOrder: takeAutoDiscount,
    });
```

- after the `stockDegraded` notice:

```jsx
                    {autoDiscountUnavailable && (
                        <div className="if-notice is-warning" role="status">
                            <span className="if-notice-icon"><IosIcon name="warn" size={20}/></span>
                            <span>{t.autoDiscountUnavailable}</span>
                        </div>
                    )}
```

- before `const bottomBar`:

```jsx
    const discountTotal = orderDiscountTotal(items);
    const discountRow = Number(discountTotal) > 0 ? (
        <div className="if-sheet-total">
            <span className="if-sheet-total-label">{t.discountTotal}</span>
            <span className="if-sheet-total-label">−{discountTotal} ₾</span>
        </div>
    ) : null;
```

and render `{discountRow}` as the first child of both fragments in `bottomBar`.

Add to the `jest.mock('../../api', ...)` in `OrderSheet.test.js`: `autoDiscount: jest.fn()` under `orderService` (the default test authData has no flag, so it is never called; the mock only keeps the import defined).

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- --watchAll=false useAutoDiscount OrderSheet`
Expected: green. Then the full suite: `npm test -- --watchAll=false` — green.

- [ ] **Step 5: Commit**

```bash
git add barcode-scanner-frontend/src/api/endpoints.js barcode-scanner-frontend/src/api/services/orderService.js barcode-scanner-frontend/src/components/UserDashboard/useAutoDiscount.js barcode-scanner-frontend/src/components/UserDashboard/useAutoDiscount.test.js barcode-scanner-frontend/src/components/UserDashboard/OrderSheet.js barcode-scanner-frontend/src/components/UserDashboard/OrderSheet.test.js
git commit -m "feat(cart): preview 1C's automatic discount while the cart is open"
```

---

### Task 9: Docs and full verification

**Files:**
- Modify: `docs/architecture/02-domain-model.md:22` (Organization switches) and the PurchaseOrderItem row
- Modify: `docs/architecture/04-authentication.md:45`
- Modify: `CLAUDE.md` (External integrations → 1C bullet)

- [ ] **Step 1: Update docs**
  - `02-domain-model.md`: add `auto_discount_enabled` to the Organization switches list; on the PurchaseOrderItem row add `auto_discount_percent` (1C's automatic percent) and state the rule "effective price = set price, else manual % (> 0), else automatic %, else list price".
  - `04-authentication.md:45`: add `auto_discount_enabled` to the login response in the sequence diagram.
  - `CLAUDE.md`, 1C bullet, after the sentence on `Gift`: "With `Organization.auto_discount_enabled`, `core/services/auto_discount.py::apply_auto_discounts` calls `CalculateAutomaticDiscount` (paid lines pooled per lookup key, gifts excluded) and stores each line's `auto_discount_percent`; the confirm recalculates it **fail-closed** before the push, and the push sends it as the line's `Discount` whenever no manual discount is set — explicitly, because CreateOrder's own automatic branch (`Discount = 0`, no `Warehouses`) knows only the quantity rules. The calculation requires a client, so a retail order needs `retail_client_id_phone` (`AUTO_DISCOUNT_NO_CLIENT`). The cart previews it through `POST orders/{id}/auto-discount/` (draft only, `ORDER_NOT_DRAFT`)." Add `auto_discount_enabled` to the login-payload key list in the Authentication section.

- [ ] **Step 2: Full backend suite**

Run: `uv run python manage.py test 2>&1 | tail -5` with `set -o pipefail`; expect the final line `OK`.
Run: `uv run python manage.py makemigrations --check --dry-run` → "No changes detected".

- [ ] **Step 3: Full frontend suite**

Run (from `barcode-scanner-frontend/`): `npm test -- --watchAll=false` → all suites pass.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/02-domain-model.md docs/architecture/04-authentication.md CLAUDE.md
git commit -m "docs: automatic discount from 1C"
```

- [ ] **Step 5: Deploy note for the hand-off** — the migration `0035_auto_discount` must be run on DO by hand (`migrate` as `doadmin`) before the frontend ships; the switch stays off for every org until the live `Sku` echo is verified against Dika's 1C.

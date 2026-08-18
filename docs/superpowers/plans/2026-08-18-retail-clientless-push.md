# Retail Clientless CreateOrder Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retail (clientless) orders always push to 1C on confirm with `ClientIDPhone` omitted; non-retail orders with no client data block the confirm with a coded 400 instead of silently skipping the push.

**Architecture:** Two-layer change along the existing confirm path: the `ConsultWebExchangeClient.create_order` wrapper stops refusing a blank client and instead omits the `ClientIDPhone` key (the variant verified against the live 1C service on 2026-08-04), and `PurchaseOrderViewSet._push_order_to_consult` replaces its silent skip with "retail → push clientless, non-retail → 400 `MISSING_CLIENT`". The frontend only gains a localized message for the new code. Spec: `docs/superpowers/specs/2026-08-18-retail-clientless-push-design.md`.

**Tech Stack:** Django 6 + DRF (backend), unittest.mock-based Django tests, React 18 CRA + jest (frontend).

## Global Constraints

- Backend tests MUST run with the repo-root uv venv, never bare `python` (bare `python` is a global Django 5.2 install). From `backend/`: `..\.venv\Scripts\python.exe manage.py test <target> -v 2`.
- Frontend jest is CRA watch-mode by default. Run one-shot from `barcode-scanner-frontend/` with: `$env:CI='true'; npm test -- --watchAll=false --testPathPattern=confirmError` (PowerShell).
- This checkout may be shared by concurrent sessions: check `git status` before committing and stage by explicit path only — never `git add -A` / `git add .`.
- Every user-facing string is added in BOTH languages in `barcode-scanner-frontend/src/i18n/translations.js` (the `ka` block near line 383 and the `en` block near line 1033).
- Error responses follow the project envelope `{"code": "MACHINE_READABLE_CODE", "detail": "human text"}`.
- End every commit message with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Client wrapper — blank `client_id_phone` omits the `ClientIDPhone` key

**Files:**
- Modify: `backend/core/services/consult_web_exchange.py:400-448` (`create_order`)
- Test: `backend/core/tests.py:2982-2997` (`CreateOrderClientTests.test_create_order_refuses_blank_client_id_phone` — replaced)

**Interfaces:**
- Consumes: existing `CreateOrderClientTests` helpers `_call(response, **overrides)`, `_mock_response(status_code, body)`, `_success_body()` (tests.py:2874-2932).
- Produces: `create_order(*, client_id_phone, user_id, stock_id, comment="", items)` now accepts `""`/`None` for `client_id_phone`; when falsy the POST body has **no** `ClientIDPhone` key and the request still goes out. Task 2's view relies on being able to pass `client_id_phone=""`.

- [ ] **Step 1: Replace the refusal test with an omission test**

In `backend/core/tests.py`, delete `test_create_order_refuses_blank_client_id_phone` (lines 2982-2997, including its comment) and add in its place:

```python
    def test_create_order_omits_blank_client_id_phone(self):
        # Blank = intentional retail sale: the key is omitted entirely (the
        # variant verified against the live test base 2026-08-04) and 1C
        # creates the order with no client attached.
        for blank in ('', None):
            result, captured = self._call(
                self._mock_response(200, self._success_body()),
                client_id_phone=blank,
            )
            self.assertNotIn('ClientIDPhone', captured['json'])
            self.assertEqual(result['OrderNumber'], '00000000051')
```

- [ ] **Step 2: Run the test to verify it fails**

From `backend/`: `..\.venv\Scripts\python.exe manage.py test core.tests.CreateOrderClientTests.test_create_order_omits_blank_client_id_phone -v 2`
Expected: ERROR — `ValueError: client_id_phone is required — upstream silently creates an orphan order without it`.

- [ ] **Step 3: Implement the omission in `create_order`**

In `backend/core/services/consult_web_exchange.py`, replace the final docstring paragraph (lines 420-423):

```
        A blank `client_id_phone` raises ValueError without any request:
        omitting it does not fail upstream — it silently creates an orphan
        order with no client attached (confirmed against the live test base
        2026-08-04).
```

with:

```
        A blank `client_id_phone` omits the `ClientIDPhone` key from the
        payload entirely; 1C then creates the order with no client attached
        (confirmed against the live test base 2026-08-04). That is
        intentional only for retail sales — the confirm view blocks
        non-retail orders from reaching here without a client.
```

Then delete the guard (lines 425-429):

```python
        if not client_id_phone:
            raise ValueError(
                "client_id_phone is required — upstream silently creates an "
                "orphan order without it"
            )
```

and change the payload build so the key is conditional. Replace:

```python
        payload: dict[str, Any] = {
            "ClientIDPhone": client_id_phone,
            "UserID": user_id,
```

with:

```python
        payload: dict[str, Any] = {
            "UserID": user_id,
```

and directly after the `payload` dict literal closes (next to the existing `if comment:` block) add:

```python
        if client_id_phone:
            payload["ClientIDPhone"] = client_id_phone
```

- [ ] **Step 4: Run the wrapper test class to verify all pass**

From `backend/`: `..\.venv\Scripts\python.exe manage.py test core.tests.CreateOrderClientTests -v 2`
Expected: all PASS (dict equality in `test_create_order_posts_documented_payload_shape` is order-insensitive, so moving the key is fine).

- [ ] **Step 5: Commit**

```bash
git add backend/core/services/consult_web_exchange.py backend/core/tests.py
git commit -m "feat(1c): create_order allows blank ClientIDPhone by omitting the key

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Confirm view — retail pushes clientless, non-retail blank client blocks

**Files:**
- Modify: `backend/core/views.py:1111-1152` (`PurchaseOrderViewSet._push_order_to_consult` docstring + no-client branch)
- Test: `backend/core/tests.py:3037-3045` (class docstring) and `3276-3290` (`CreateOrderOnConfirmTests.test_retail_order_without_setting_confirms_without_push` — replaced, plus one new test)

**Interfaces:**
- Consumes: Task 1's `create_order` accepting `client_id_phone=""` (the view's call site passes it through unchanged at views.py:1217-1223); existing test helpers `_order(status='draft', **extra)`, `_item(order, ...)`, `_confirm(order)`, `_plenty_of_stock(mstock)`, `_success(number='00000000051')` (tests.py:3056-3087). `_order` defaults include client fields, so blank-client orders pass `customer_name=''` etc. explicitly; `PurchaseOrder.is_retail` exists (models.py:273).
- Produces: confirm of a clientless retail order → 200, pushed, `external_order_number` saved; confirm of a clientless non-retail order → 400 `{"code": "MISSING_CLIENT", "detail": "Order has no client; only retail orders can confirm without one."}`, no push, status unchanged. Task 3's frontend maps `MISSING_CLIENT`.

- [ ] **Step 1: Replace the skip test and add the anomaly test**

In `backend/core/tests.py`, delete `test_retail_order_without_setting_confirms_without_push` (lines 3276-3290) and add in its place:

```python
    def test_retail_order_without_setting_pushes_clientless(self, mstock, mcreate):
        self._plenty_of_stock(mstock)
        mcreate.return_value = self._success()
        order = self._order(
            is_retail=True, customer_name='', customer_phone='',
            customer_identification_number='',
        )
        self._item(order)

        r = self._confirm(order)

        self.assertEqual(r.status_code, 200)
        self.assertEqual(mcreate.call_args.kwargs['client_id_phone'], '')
        order.refresh_from_db()
        self.assertEqual(order.status, 'confirmed')
        self.assertEqual(order.external_order_number, '00000000051')

    def test_non_retail_order_without_client_blocks_confirm(self, mstock, mcreate):
        self._plenty_of_stock(mstock)
        order = self._order(
            customer_name='', customer_phone='',
            customer_identification_number='',
        )
        self._item(order)

        r = self._confirm(order)

        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()['code'], 'MISSING_CLIENT')
        mcreate.assert_not_called()
        order.refresh_from_db()
        self.assertEqual(order.status, 'draft')
```

Also update the `CreateOrderOnConfirmTests` class docstring (tests.py:3038-3045): replace its last sentence

```
    webhook. Skips: already-pushed orders, and clientless orders when the
    org has no retail counterparty configured.
```

with:

```
    webhook. Skips: already-pushed orders. Retail orders with no client
    push with ClientIDPhone omitted; non-retail orders with no client
    block with MISSING_CLIENT.
```

- [ ] **Step 2: Run the two tests to verify they fail**

From `backend/`: `..\.venv\Scripts\python.exe manage.py test core.tests.CreateOrderOnConfirmTests.test_retail_order_without_setting_pushes_clientless core.tests.CreateOrderOnConfirmTests.test_non_retail_order_without_client_blocks_confirm -v 2`
Expected: both FAIL — the retail test because `mcreate` is never called (skip still in place), the non-retail test because the response is 200, not 400.

- [ ] **Step 3: Replace the skip branch in `_push_order_to_consult`**

In `backend/core/views.py`, replace the no-client branch (lines 1144-1152):

```python
        if not client_id_phone:
            # Never call CreateOrder without a ClientIDPhone — upstream
            # silently creates an orphan order with no client attached.
            logging.warning(
                "CreateOrder push skipped for order=%s — no client and no "
                "retail counterparty configured for org=%s",
                order.id, order.organization_id,
            )
            return None
```

with:

```python
        if not client_id_phone:
            if not order.is_retail:
                # A customer order with no client data is an anomaly — fail
                # loud rather than create a clientless sale in 1C.
                return Response(
                    {
                        "code": "MISSING_CLIENT",
                        "detail": "Order has no client; only retail orders can confirm without one.",
                    },
                    status=http_status.HTTP_400_BAD_REQUEST,
                )
            client_id_phone = ""
            logging.info(
                "CreateOrder push for retail order=%s with no client — "
                "ClientIDPhone omitted", order.id,
            )
```

Also update the method docstring's last paragraph (views.py:1121-1123). Replace:

```
        Skipped entirely for orders already pushed (there is no UpdateOrder
        upstream — edits after a push do not reach 1C) and for clientless /
        retail orders while the org has no retail counterparty configured.
```

with:

```
        Skipped entirely for orders already pushed (there is no UpdateOrder
        upstream — edits after a push do not reach 1C). Retail orders with
        no client push with ClientIDPhone omitted (1C creates the order
        with no client attached); a non-retail order with no client data
        blocks with MISSING_CLIENT.
```

- [ ] **Step 4: Run the confirm test classes to verify all pass**

From `backend/`: `..\.venv\Scripts\python.exe manage.py test core.tests.CreateOrderOnConfirmTests core.tests.ConfirmStockGuardTests core.tests.RetailOrderAPITests -v 2`
Expected: all PASS (the retail-counterparty override test `test_retail_order_uses_org_retail_counterparty` must stay green).

- [ ] **Step 5: Commit**

```bash
git add backend/core/views.py backend/core/tests.py
git commit -m "feat(orders): retail orders push to 1C clientless; MISSING_CLIENT guard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Frontend — localized MISSING_CLIENT confirm error

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/confirmError.js:33-34` (new case)
- Modify: `barcode-scanner-frontend/src/i18n/translations.js:387` (ka) and `:1037` (en)
- Test: `barcode-scanner-frontend/src/components/UserDashboard/confirmError.test.js`

**Interfaces:**
- Consumes: Task 2's `MISSING_CLIENT` code; `formatConfirmError(result, t)` already wired into `handleProceedToPayment` (UserDashboard.js:689) — no dashboard change needed.
- Produces: `formatConfirmError({code: 'MISSING_CLIENT'}, t)` → `{title: t.orderError, message: t.missingClientError}`; translation key `missingClientError` in both `ka` and `en` blocks.

- [ ] **Step 1: Write the failing test**

In `confirmError.test.js`, after the warehouse/empty-order guards test (line 42), add:

```javascript
    it('maps MISSING_CLIENT to a localized message', () => {
        for (const lang of ['ka', 'en']) {
            const mapped = formatConfirmError({code: 'MISSING_CLIENT', data: {}}, translations[lang]);
            expect(mapped.title).toBe(translations[lang].orderError);
            expect(mapped.message).toBe(translations[lang].missingClientError);
        }
    });
```

- [ ] **Step 2: Run it to verify it fails**

From `barcode-scanner-frontend/` (PowerShell): `$env:CI='true'; npm test -- --watchAll=false --testPathPattern=confirmError`
Expected: the new test FAILS (`mapped` is null); the other six pass.

- [ ] **Step 3: Add the case and both translations**

In `confirmError.js`, after the `EMPTY_ORDER` case (line 34), add:

```javascript
        case 'MISSING_CLIENT':
            return {title: t.orderError, message: t.missingClientError};
```

In `translations.js`, after `itemLookupKeyMissingGeneric` in the `ka` block (line 387), add:

```javascript
        missingClientError: 'შეკვეთას კლიენტი არ აქვს — კლიენტის გარეშე დადასტურება მხოლოდ საცალო შეკვეთას შეუძლია',
```

and after `itemLookupKeyMissingGeneric` in the `en` block (line 1037), add:

```javascript
        missingClientError: 'The order has no client — only retail orders can confirm without one',
```

- [ ] **Step 4: Run the test file to verify all pass**

From `barcode-scanner-frontend/` (PowerShell): `$env:CI='true'; npm test -- --watchAll=false --testPathPattern=confirmError`
Expected: all 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/confirmError.js barcode-scanner-frontend/src/components/UserDashboard/confirmError.test.js barcode-scanner-frontend/src/i18n/translations.js
git commit -m "feat(frontend): localized MISSING_CLIENT confirm error

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Docs — CLAUDE.md and superseded note on the old spec

**Files:**
- Modify: `CLAUDE.md:77` (the ConsultWebExchange bullet)
- Modify: `docs/superpowers/specs/2026-08-11-createorder-on-confirm-design.md:1-4` (add superseded note)

**Interfaces:**
- Consumes: the behavior implemented in Tasks 1-2.
- Produces: docs that match the shipped behavior; no code.

- [ ] **Step 1: Update CLAUDE.md**

In the `CLAUDE.md` line-77 bullet, replace the two sentences:

```
Never call `create_order` without a `ClientIDPhone` — the live service silently creates an orphan order. Retail/clientless orders use `Organization.retail_client_id_phone`; while that is blank they confirm without a push.
```

with:

```
A blank `ClientIDPhone` is intentional only for retail orders: `create_order` omits the key and 1C creates the order with no client attached, while a non-retail order with no client data blocks the confirm with `MISSING_CLIENT`. Retail/clientless orders use `Organization.retail_client_id_phone` when configured, else they push clientless.
```

- [ ] **Step 2: Add the superseded note to the 2026-08-11 spec**

In `docs/superpowers/specs/2026-08-11-createorder-on-confirm-design.md`, insert after the `Date: 2026-08-11 …` block (line 4), separated by blank lines:

```markdown
> **Superseded in part (2026-08-18):** clientless orders no longer confirm
> without a push — retail orders now push with `ClientIDPhone` omitted, and
> non-retail orders with no client data block with `MISSING_CLIENT`. See
> `2026-08-18-retail-clientless-push-design.md`.
```

Do not rewrite the rest of the old spec.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-08-11-createorder-on-confirm-design.md
git commit -m "docs: retail clientless push — CLAUDE.md and spec supersede note

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Full-suite verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: everything above.
- Produces: green backend `core` suite and green frontend confirm-flow tests.

- [ ] **Step 1: Run the whole backend core suite**

From `backend/`: `..\.venv\Scripts\python.exe manage.py test core -v 1`
Expected: OK, zero failures.

- [ ] **Step 2: Run the frontend UserDashboard tests**

From `barcode-scanner-frontend/` (PowerShell): `$env:CI='true'; npm test -- --watchAll=false --testPathPattern="UserDashboard|orderService"`
Expected: all PASS.

- [ ] **Step 3: Report results**

No commit — report the outputs. If anything fails, use superpowers:systematic-debugging before touching code.

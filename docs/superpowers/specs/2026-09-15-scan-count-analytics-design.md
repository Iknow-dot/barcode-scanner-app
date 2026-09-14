# Scan count and completed orders in consultant analytics

ClickUp: [86cbewehz](https://app.clickup.com/t/86cbewehz) (sub-task of 86c9yqnuu).
Status: implemented (commits 3ba10d5, 4493c42, e507398, ab04f3f).

## Goal

The admin analytics table (`AnalyticsTab`, backed by `GET /api/v1/analytics/orders/`)
shows, per consultant, orders created, orders confirmed and a conversion rate.
Add two columns:

1. **Scans** (დასკანერებები) — how many product lookups the consultant started.
2. **Completed** (დასრულებული) — how many of their orders reached `completed`.

## Background

- There is no server-side record of scans. The only scan data is a per-device
  localStorage log (`src/utils/scanLog.js`) feeding the dashboard's daily snapshot.
  ClickUp 86c9yqnuu claims a `ScanEvent` model shipped in commit `9197ae1`; that
  commit exists nowhere, so scan tracking is built from scratch here.
- `POST /api/v1/product/search/` is called for several reasons, only some of which
  are a consultant looking something up — see *What counts as a scan*.
- `PurchaseOrder` has no `completed_at`; the 1C completion webhook only sets
  `status='completed'`.

## Decisions

| Question | Decision |
|----------|----------|
| What counts as a scan | Every lookup a user starts, found or not |
| Date attribution of "completed" | Orders **created** in the range that are now `completed` — the same cohort as every other column |
| How a scan is recorded | Server-side in `ProductSearchAPIView`, gated by a `record_scan` request flag |
| Meaning of `orders_confirmed` | Unchanged: `confirmed` **or** `completed`, so created ≥ confirmed ≥ completed |
| Scan-based conversion rate | Not added |

### What counts as a scan

`UserDashboard.handleSearch` is the only frontend path that represents a user
lookup. It has four callers:

| Caller | Counts |
|--------|--------|
| `handleScanResult` — camera scan | yes |
| `handleSelectFromCatalog` — Find-product drawer (typeahead or category browse) | yes |
| `handleResearchFromHistory` — re-run from today's scan history | yes |
| `handleShowOtherWarehouses` — re-run of the last lookup with the warehouse filter dropped | no |

Other `productService.searchProduct` callers never count:
`OrderPanel.ensureStock` (cart stock refresh) and `offlineOrderSync` (replay of an
offline-queued barcode). An offline camera scan returns early from `handleSearch`
without contacting the server, so it is not counted either.

`allWarehouses` cannot be used to tell the callers apart — it is also the user's
own "all warehouses" toggle, passed by the three counted callers. The flag is an
explicit argument instead.

### Approaches considered

- **A — flag on product search (chosen).** No extra request per scan; user, org
  and time are server-trusted; the row is written before the 1C call, so not-found
  and upstream-failure lookups count.
- **B — dedicated `POST /scans/` endpoint.** Decoupled, but an extra mobile round
  trip per scan that loses counts silently when it fails, and client-supplied data
  to validate.
- **C — count every search call.** Inflated by cart stock refreshes and re-runs.

## Design

### Model

`core/models.py`, migration `0032`:

```python
class ScanEvent(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='scan_events')
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='scan_events')
    value = models.CharField(max_length=255)
    is_barcode = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=['organization', 'created_at'])]
```

`user` is `SET_NULL` like `PurchaseOrder.created_by`, so deleting a user keeps the
org's history. Not registered in the Django admin.

### Recording

- `ProductSearchSerializer` gains `record_scan = BooleanField(required=False, default=False, write_only=True)`.
  The view passes `record_scan` into the data it validates.
- After `serializer.is_valid(raise_exception=True)` and before the replica lookup,
  when `record_scan` is true and the user has an organization, the view writes one
  `ScanEvent(organization, user, value=sku, is_barcode=bool(is_barcode))`.
- A request that fails validation (400) records nothing.
- The insert runs inside its own `transaction.atomic()` savepoint. On
  `DatabaseError` the view calls `logger.exception(...)` and continues with the
  lookup. Reason: production does not run migrations on deploy, and product search
  is the app's core flow — a missing table must never block a consultant's scan.
  The logged exception reaches Sentry when it is configured.

### Frontend recording

- `productService.searchProduct({..., recordScan = false})` sends `record_scan: true`
  only when `recordScan` is true (the key is omitted otherwise).
- `handleSearch` accepts `recordScan` and forwards it. The three counted callers
  pass `recordScan: true`; `handleShowOtherWarehouses` does not.

### Analytics endpoint

`OrderAnalyticsAPIView` keeps its URL, date defaults, and org scoping
(internal admin: optional `organization` filter; company admin: own org).

- The order aggregate gains `orders_completed = Count('id', filter=Q(status='completed'))`.
- A second aggregate over `ScanEvent` uses the same `created_at__date` range and org
  scope, excludes `user IS NULL`, groups by user into `scans`.
- The two are merged by `user_id` in Python. A consultant present only in scans
  gets a row with zero order counts.
- Rows sort by `orders_created` desc, then `scans` desc.
- Row: `user_id, username, scans, orders_created, orders_confirmed, orders_completed, conversion_rate`.
- `totals` gains `scans` and `orders_completed`.
- `conversion_rate` stays `orders_confirmed / orders_created`.
- `ConsultantOrderStatsSerializer` gains `scans` and `orders_completed`.

The change is additive: existing keys keep their values.

### Analytics table

`AnalyticsTab` columns, in funnel order:
consultant | scans | orders created | confirmed | completed | conversion.
The summary row gains the two totals at matching indices.

New translation keys:

| Key | ka | en |
|-----|----|----|
| `analyticsScans` | დასკანერებები | Scans |
| `ordersCompleted` | დასრულებული | Completed |

## Rollout

Run `uv run python manage.py migrate` against production after this deploys.
Until then, product search keeps working (the scan insert fails and is logged) and
the analytics endpoint answers 500 — admin-only.

## Testing

Backend, `core/tests/test_products.py`:
- `record_scan: true` writes one `ScanEvent` on a replica hit, on a replica miss
  that 404s `PRODUCT_NOT_FOUND`, and when 1C raises `ConsultWebExchangeError`.
- Absent or false `record_scan` writes none.
- A 400 validation failure writes none.
- The row carries the requesting user and their organization.
- A `DatabaseError` from the insert still returns the lookup response.

Backend, `core/tests/test_analytics.py`:
- `orders_completed` counts only `completed` orders.
- Scans inside the range count; scans outside it do not.
- A consultant with scans and no orders gets a zero-order row.
- A company admin does not see another organization's scans.
- `totals` include `scans` and `orders_completed`.

Frontend:
- `productService` test: `record_scan` is sent only when `recordScan` is true.
- `AnalyticsTab` has no test harness; verify the table in a browser.

## Docs

- `docs/architecture/02-domain-model.md`: add `ScanEvent` to the ER diagram.
- `docs/architecture/05-catalog-and-search.md`: show the scan record step in the
  scan → product card sequence.
- `CLAUDE.md`: mention `ScanEvent` in the `core` model list and the `record_scan`
  flag in the `ProductSearchAPIView` paragraph.

## Out of scope

- Counting offline scans.
- A `completed_at` timestamp or completion-date attribution.
- Scan-to-order conversion, per-product scan statistics, retention/cleanup of
  `ScanEvent` rows.
- Resolving the ClickUp 86c9yqnuu record of the lost commit.

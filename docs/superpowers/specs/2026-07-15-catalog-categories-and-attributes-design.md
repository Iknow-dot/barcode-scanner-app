# Catalog replica — nested categories & dynamic product attributes

**Date:** 2026-07-15
**Branch:** `djangoRewrite`
**Status:** Design approved (pending written-spec review) → next step: implementation plan
**Companion artifact:** *Product Catalog Replica — UML Architecture* (`claude.ai/code/artifact/8b980908-…`), to be updated to reflect this design.

---

## 1 · Context

The catalog replica already exists: each org's 1C system **pushes** its catalog into our ingest API
(`POST /catalog/products/`), we upsert by `(organization, sku)`, and `row_hash()` skips no-op re-pushes.
Products carry `article`, `name`, `price`, `image_urls`, and child `ProductBarcode` rows. Scan and
name-search read the replica; live stock/price is still fetched from 1C at scan time.

Two capabilities are being added, both **fed from the existing product push** (no new management API):

1. **Nested categories** — a product's category hierarchy, derived from data 1C sends with each product,
   surfaced as a breadcrumb on scan/search results.
2. **Dynamic per-org attributes** — an arbitrary, org-specific set of extra product fields pushed by 1C,
   displayed to consultants under an org-curated visibility layout.

This design was hardened by a four-way adversarial critique (category-tree modeling, attribute storage,
codebase fit/tenancy, and a YAGNI devil's-advocate). The decisions below reflect that review.

## 2 · Confirmed requirements & scope

**In scope (v1):**
- Categories are **nested**, **derived from the product push**, and **display-first** — a breadcrumb on
  scan and name-search results. No category-browsing/tree-navigation endpoints yet.
- 1C sends the **full category ancestry chain with names** on every product (confirmed available).
- Attributes are **pushed from 1C** as an arbitrary per-org dict, **stored verbatim**, and are
  **view-only** for consultants.
- Attribute visibility is **curated**: hidden by default, an admin approves which keys are shown;
  responses are **projected** through the visible allowlist.

**Out of scope (deferred — see §11):**
- Category-listing / tree-navigation endpoints and category filtering of search.
- Attribute **search/filter** (and the Postgres GIN/expression index that enables it).
- Any org-facing self-service category or attribute **management API** (curation is via Django admin in v1).
- Category node pruning / cleanup.

## 3 · Data model

All changes are **additive** (two new tables, two nullable/defaulted `Product` fields). No backfill:
existing rows default cleanly and repopulate on the next push.

### 3.1 `ProductCategory` (new)

| Field | Type | Notes |
|---|---|---|
| `organization` | FK → Organization, `CASCADE`, `related_name="product_categories"` | Tenancy anchor. |
| `external_id` | Char | Stable 1C category id. |
| `name` | Char | Current display name of **this** node. |
| `parent` | self-FK, `null=True`, `on_delete=SET_NULL`, `related_name="children"` | Adjacency link. |
| `path_names` | JSON (list of str) | Root→leaf display names, for the breadcrumb. Maintained at ingest. |
| `path` | Char | Stable id materialized-path, e.g. `"/7/42/"`. For subtree refresh now and the future subtree filter. Rename-immune (ids never change). |

Constraint: `UniqueConstraint(organization, external_id)`.
Nodes are **kept forever** (never pruned on ingest), mirroring the "deactivated products kept forever" policy.

> **Why not denormalize path onto the Product?** Under delta pushes, an upstream **rename** changes an
> ancestor's name but not any leaf product's synced fields, so descendants are never re-pushed. Names copied
> onto products would go **permanently stale**. Keeping names on the node and reading through the FK makes a
> rename a bounded **category-subtree** update, fully decoupled from product pushes.

### 3.2 `ProductAttribute` (new — metadata-only registry)

| Field | Type | Notes |
|---|---|---|
| `organization` | FK → Organization, `CASCADE`, `related_name="product_attributes"` | Tenancy anchor. |
| `key` | Char | Matches a key in `Product.attributes`. |
| `label` | Char | Display label (admin-editable; defaults to a humanized `key`). |
| `order` | PositiveInt | Layout order. |
| `is_visible` | Bool, **default `False`** | The exposure gate + curation toggle. |
| `first_seen_at` | DateTime | When the key was first observed in a push. |
| `type` | Char, optional | Display **hint** only (inferred at first-seen, admin-overridable). **Never enforced** — ingest never rejects or coerces a value. |

Constraint: `UniqueConstraint(organization, key)`.
This registry is **O(keys per org)** — explicitly **not EAV** (no per-value rows), which keeps the atomic
single-row product upsert intact. It holds **no values**; values live in `Product.attributes`.

### 3.3 `Product` (additions)

| Field | Type | Notes |
|---|---|---|
| `category` | FK → ProductCategory, `null=True`, `on_delete=SET_NULL`, `related_name="products"` | The product's own (leaf) category. `NULL` = uncategorized. |
| `attributes` | JSON (dict), `default=dict` | The raw attribute dict from 1C, stored **verbatim**, never dropped. |

The product does **not** store category names — the breadcrumb is read via `select_related('category')`.

## 4 · Ingest contract (push payload)

Each product object in `POST /catalog/products/` gains two optional, back-compatible keys:

```jsonc
{
  "sku": "A-100",
  "article": "AX100",
  "name": "Frying pan 24cm",
  "price": "39.90",
  "barcodes": ["4860001234567"],
  "image_urls": ["https://1c.example/img/a-100-0.jpg"],

  // NEW — full ancestry, root→leaf; last element is the product's own category.
  // [] or omitted → uncategorized.
  "category": [
    {"id": "7",  "name": "Cookware"},
    {"id": "42", "name": "Pans"}
  ],

  // NEW — arbitrary flat key→scalar map (nested values allowed but treated
  // display-only). Stored verbatim. Org is derived from the push token; the
  // body never names an org.
  "attributes": {"color": "black", "diameter_cm": "24", "nonstick": true}
}
```

**Why the full chain (not leaf-id + parent-id):** with paged, any-order pushes, a bare leaf+parent can
never name a pure **branch** node (one with no direct products) nor resolve grand-ancestry from a single
row. The full chain makes the branch materialize from one product row, order-independent, and reduces
cycle detection to an in-memory duplicate-id check.

## 5 · Ingest processing

All within the existing `CatalogProductIngestAPIView.post` `transaction.atomic()` block. The org is derived
from the push token (`organization_from_push`); **every** category and attribute write is scoped to that org.

### 5.1 Category resolution (per product, memoized)

- Maintain a per-request `category_cache` keyed by `external_id` so each distinct node is resolved at most
  once per batch (turns thousands of per-row category queries into ~one per distinct node — avoids the N+1
  on large full pushes).
- **Validate the chain in memory first:** a duplicate id (cycle / self-parent) → treat the product as
  **uncategorized** (`category=NULL`), increment an error counter, record it in `CatalogIngestState`, and
  **never abort the batch**.
- Walk the chain root→leaf. For each node, `get_or_create(organization=org, external_id=id)` with
  IntegrityError **catch-and-refetch** (or `ignore_conflicts`) so parallel onboarding pages don't abort
  each other on the unique constraint. Set `parent` from the previous element, `name` from the payload.
- Maintain `path` (`"/<id0>/<id1>/…/"`) and `path_names` on each node.
- **Rename propagation:** resolve categories for **every** item *before* the `row_hash` skip-check. If a
  pushed node's `name` differs from the stored node, update it and recompute `path_names` for its
  **subtree** (`ProductCategory.objects.filter(organization=org, path__contains="/<id>/")`) — a bounded
  update that heals all descendants without touching product rows.
- Set `product.category` to the **leaf** node.

### 5.2 Attribute storage & registration

- Store `item.get("attributes") or {}` **verbatim** into `Product.attributes` in the `update_or_create`
  defaults. Never validate/coerce/reject.
- Accumulate the batch's distinct attribute keys in an in-memory set during the product loop. **After** the
  loop (still in the transaction), register unseen keys with **one** `ProductAttribute.objects.bulk_create(
  …, ignore_conflicts=True)` — never a per-row `get_or_create`.
- New keys default to `is_visible=False`, `label=humanize(key)`, `order` after existing keys,
  `type` inferred from the first-seen value. **Cap** registered keys per org (~50–100) and bound key length;
  past the cap, stop registering schema rows but **keep storing values** verbatim.

### 5.3 Idempotency (`catalog.row_hash`) — load-bearing

Extend the pure `row_hash()` to fold in **both** new fields, using the existing
`json.dumps(sort_keys=True, ensure_ascii=False)` serialization (recursive key-sorting normalizes ordering):
- the category chain (ids **and** names — so any ancestor rename flips the fingerprint), and
- the `attributes` dict.

Without this, a re-parent or attribute-only edit hashes identical to the stored row and is silently
**skipped**. Node-side subtree refresh (§5.1) is the primary rename mechanism; the hash is the backstop.

## 6 · Read / response changes (no new endpoints)

Category breadcrumb and visible attributes ride the **already-org-scoped** product responses — **zero new
read surface**, which sidesteps the cross-org-leak risk class entirely.

- **`ProductSearchAPIView`** (scan, `views.py:397`): the replica fast-path `payload` gains
  `category_path` (from `product.category.path_names`; fetch with `select_related('category')`) and
  `attributes` **projected** through the org's `is_visible` allowlist. The live-miss `_lazy_upsert` path
  carries no category/attributes (1C's `GetStockAndPrices` doesn't provide them) — it self-heals on the
  next catalog push; response simply omits them there.
- **`CatalogProductSearchAPIView`** (name search): each row gains `category_path`.
- **Serializers:** `ProductSearchSerializer` gains `category_path` (ListField, read-only) and `attributes`
  (JSON/Dict, read-only); `CatalogProductSerializer` gains `category_path`. Ingest doc serializer
  `CatalogIngestProductSerializer` documents the new optional `category` and `attributes` keys; refresh the
  `@extend_schema` request examples.

**Projection (the exposure gate):** attribute serialization for a consultant filters `Product.attributes`
to the keys where the org's `ProductAttribute.is_visible` is true, ordered by `order`, labeled by `label`.
Hidden keys (e.g. `cost_price`, `supplier_margin`, `internal_guid`) are **never serialized** to a
`company_user`, even though stored. Load the org's visible schema once per request, not per row.

## 7 · Multi-tenancy & security

- 1C category ids **collide across orgs** — every category `get_or_create`/lookup **must** pass
  `organization=org` (token-derived). Regression test: same category id under two orgs → two distinct rows,
  no `path_names` bleed.
- No new read endpoints; category/attribute data is exposed only through the existing product responses,
  which already filter by `request.user.organization`.
- The attribute **projection** doubles as tenant hygiene and prevents sensitive-field exposure to consultants.
- `attributes` keys are 1C-influencable (a leaked `webhook_token` could inject keys) → **hidden-by-default**
  plus the per-org registration cap contain the blast radius.
- No change to `core/schema.py`'s integration `allowed` set — only the two ingest views belong in the
  external-partner contract.

## 8 · Admin (Jazzmin)

- Register `ProductCategory` (`list_display`: org, name, external_id, parent; `list_filter`: organization).
- Register `ProductAttribute` (`list_display`: org, key, label, is_visible, order; `list_filter`:
  organization; **`list_editable`: is_visible, order, label**) — this **is** the "build your minimal
  layout" / approval UI in v1.
- Add `category` to `ProductAdmin` `list_display`/`list_filter`.

## 9 · Migrations & portability

- One additive migration: two new models + `Product.category`, `Product.attributes`. Nullable/defaulted,
  no backfill.
- `JSONField` is portable across Postgres and SQLite (dev). No Postgres-only feature in v1.
- The future subtree filter is a portable `path__contains="/<id>/"` **LIKE** — no `ltree`, no JSON
  containment, no recursive CTE.

## 10 · Failure modes addressed (from the critique)

| Risk | Severity | Mitigation |
|---|---|---|
| Leaf+parent can't name branch nodes / grand-ancestry | high | Full ancestry chain with names in the payload. |
| Denormalized category **names** on Product go stale on rename under deltas | high | Names on the node; breadcrumb via FK read-through; bounded subtree refresh. |
| Cross-org category id collision leaks paths | high | Scope every `get_or_create` by token-derived org; two-org regression test. |
| Auto-visible attributes leak cost/margin/internal keys | high | `is_visible=False` default + response projection through the visible allowlist. |
| Attribute-only / re-parent edits skipped by idempotency | high | Extend `row_hash()` to include category chain + attributes (sorted-key). |
| Key explosion (300 keys / noisy one-offs) | high | Batched `bulk_create(ignore_conflicts)`, per-org cap, key-length bound; values still stored. |
| Category get-or-create N+1 on large pushes | med | Per-batch `category_cache` memoization. |
| Concurrent paged pushes race on node creation | med | `get_or_create` catch-and-refetch / `ignore_conflicts`. |
| Cycle / self-parent → unbounded walk | med | In-memory duplicate-id check → `category=NULL`, error counter, no abort. |
| Enforced attribute `type` drops heterogeneous values | med | `type` is a non-enforced display hint; always store raw. |
| Subtree never re-pushed → stale name until re-baseline | med (residual) | Documented; mitigated by periodic `is_full` pushes. |

## 11 · Deferred / future work

- **Category filtering of search** — `Product.objects.filter(category__path__contains="/<id>/")` (already
  unlocked by `ProductCategory.path`; no migration needed).
- **Attribute search** — add `is_searchable` to the registry + a Postgres `GinIndex`/expression index behind
  `connection.vendor == 'postgresql'` with a SQLite `icontains` fallback (pure additive migration).
- **Category tree-navigation endpoints** and an **org-facing attribute/category management API** (v1 curates
  via Django admin).
- **Category node cleanup** for genuinely dead subtrees (explicit admin action).

## 12 · Testing

- `row_hash` pure unit tests: attribute-only change → `upserted` not `skipped`; category rename → hash
  differs; reordered nested attribute keys → hash **stable**.
- Ingest: full chain builds nodes + `path`/`path_names`; branch-node naming; rename refreshes the subtree
  without touching products; cycle chain → uncategorized + error counter, batch not aborted; N-page parallel
  push doesn't abort on node-create race.
- Tenancy: same category id under two orgs → two rows, no path bleed; hidden attribute key never appears in a
  consultant response; visible key appears with its label/order.
- Attribute cap: past the per-org cap, values still stored but no new registry rows.
- Responses: scan + name-search include `category_path`; scan includes only visible, ordered attributes.

## 13 · Dependencies / open items

- **1C side** must emit the `category` ancestry chain (id + current name per node) and the `attributes` dict
  on the product push. Confirmed available; field-name mapping to be verified against the live 1C payload
  before/at implementation (consistent with the existing "update `*_FIELDS` placeholders once confirmed"
  practice in `consult_web_exchange.py`).
- Per-org attribute-key **cap** value to finalize (default ~50–100).

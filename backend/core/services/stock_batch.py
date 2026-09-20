# backend/core/services/stock_batch.py
"""Batch live-stock lookup against the per-org 1C ConsultWebExchange service.

Split into three strictly separated phases, because Django opens a new database
connection per thread and never reaps it for a non-request thread. Production
has 8 concurrent request slots in front of a PgBouncer pool of 16, so worker
threads touching the ORM would exhaust the pool at two workers each. All ORM
work therefore happens on the request thread and the pool does nothing but HTTP:

    A. resolve_lookup_keys   request thread, DB
    B. fetch_stock_concurrently   pool threads, HTTP only
    C. apply_self_heal       request thread, DB
"""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from concurrent.futures import TimeoutError as FuturesTimeoutError
from dataclasses import dataclass

from django.conf import settings
from django.utils import timezone

from core.catalog.fingerprint import row_hash
from core.catalog.image_urls import signed_image_paths
from core.models import Product, ProductBarcode
from core.services.consult_web_exchange import ConsultWebExchangeClient, ConsultWebExchangeError

logger = logging.getLogger(__name__)


@dataclass
class RequestedItem:
    """One entry of the request's ``items`` list."""

    sku: str
    is_barcode: bool


@dataclass
class ResolvedItem:
    """A requested item paired with what the replica knows about it.

    ``lookup_key`` is what 1C will actually be asked for, which is often not
    the requested value: 1C resolves a barcode or an article and rejects the
    nomenclature code with 421.  ``None`` means the replica holds neither, so
    there is nothing worth asking.
    """

    requested: str
    is_barcode: bool
    product: Product | None
    lookup_key: str | None
    lookup_is_barcode: bool


def resolve_lookup_keys(organization, items: list[RequestedItem]) -> list[ResolvedItem]:
    """Phase A: match every requested value against the replica.

    A bounded number of queries, independent of batch size: one query for the
    barcode items (if any), plus one for the SKU items and one for their
    prefetched barcodes (if any) — so the count never grows with the number
    of items. 1 query for an all-barcode batch, 2 for an all-SKU batch, 3 for
    a batch that mixes both.
    """
    barcodes = {item.sku for item in items if item.is_barcode}
    skus = {item.sku for item in items if not item.is_barcode}

    by_barcode: dict[str, Product] = {}
    if barcodes:
        matches = ProductBarcode.objects.filter(
            product__organization=organization,
            barcode__in=barcodes,
            product__is_active=True,
        ).select_related("product")
        for match in matches:
            by_barcode.setdefault(match.barcode, match.product)

    by_sku: dict[str, Product] = {}
    if skus:
        products = Product.objects.filter(
            organization=organization, sku__in=skus, is_active=True,
        ).prefetch_related("barcodes")
        by_sku = {product.sku: product for product in products}

    resolved = []
    for item in items:
        product = (by_barcode if item.is_barcode else by_sku).get(item.sku)
        key, key_is_barcode = _lookup_key(product, item)
        resolved.append(ResolvedItem(
            requested=item.sku,
            is_barcode=item.is_barcode,
            product=product,
            lookup_key=key,
            lookup_is_barcode=key_is_barcode,
        ))
    return resolved


def _lookup_key(product: Product | None, item: RequestedItem) -> tuple[str | None, bool]:
    # A replica miss goes to 1C with the raw scanned value, as the pre-split
    # miss path did — 1C may well know a product we have not been pushed yet.
    if product is None:
        return item.sku, item.is_barcode
    if item.is_barcode:
        return item.sku, True
    if product.article:
        return product.article, False
    known = next(iter(product.barcodes.all()), None)
    if known:
        return known.barcode, True
    return None, False


STATUS_OK = "ok"
STATUS_UNAVAILABLE = "unavailable"
STATUS_NO_LOOKUP_KEY = "no_lookup_key"
STATUS_NOT_FOUND = "not_found"


@dataclass
class StockOutcome:
    """What one requested value resolved to.

    ``product`` is filled in only by phase C, and only for a replica miss that
    1C could identify — it is the self-heal echo the client renders from.
    """

    status: str
    data: dict | None = None
    product: dict | None = None


def _has_identity(payload: dict) -> bool:
    """Whether 1C returned anything identifiable.

    1C answers 201 "No Stock" with a body carrying no product data, and uses it
    both for an unknown barcode and for a known item that is out of stock.
    Only the replica can tell those apart, so this is consulted only on a miss.
    """
    return bool(payload.get("sku_name") or payload.get("article"))


def _fetch_one(client, item: ResolvedItem, warehouses: str) -> StockOutcome:
    """Runs on a pool thread. MUST NOT touch the ORM — see the module docstring."""
    try:
        payload = client.get_stock_and_prices(
            item.lookup_key, is_barcode=item.lookup_is_barcode, warehouses=warehouses,
        )
        if item.product is None and not _has_identity(payload):
            return StockOutcome(status=STATUS_NOT_FOUND)
        return StockOutcome(status=STATUS_OK, data=payload)
    except ConsultWebExchangeError as exc:
        if exc.code == "PRODUCT_NOT_FOUND" and item.product is None:
            return StockOutcome(status=STATUS_NOT_FOUND)
        # A product we hold whose live lookup failed is degraded, not missing:
        # calling it "not found" sends the consultant hunting for something
        # that exists.
        return StockOutcome(status=STATUS_UNAVAILABLE)
    except Exception:  # one item must never fail the batch
        logger.exception("Stock lookup failed for %s", item.requested)
        return StockOutcome(status=STATUS_UNAVAILABLE)


def fetch_stock_concurrently(
    client,
    resolved: list[ResolvedItem],
    warehouses: str,
    *,
    deadline_seconds: float,
    max_workers: int,
) -> dict[str, StockOutcome]:
    """Phase B: one upstream call per item, bounded by a shared wall clock.

    Anything unfinished when the deadline expires is reported ``unavailable``
    rather than failing the request: partial results beat a router 502, whose
    body the browser never sees.

    The result is keyed by ``ResolvedItem.requested``. When ``resolved``
    holds the same requested value more than once (a duplicate in the
    request's ``items``), it is fetched upstream only once — the duplicates
    collapse onto a single submitted item and every one of them reads that
    same outcome from the returned dict.
    """
    outcomes: dict[str, StockOutcome] = {}
    submittable: list[ResolvedItem] = []
    queued: set[str] = set()
    for item in resolved:
        if item.lookup_key is None:
            outcomes[item.requested] = StockOutcome(status=STATUS_NO_LOOKUP_KEY)
        elif item.requested not in queued:
            submittable.append(item)
            queued.add(item.requested)

    if not submittable:
        return outcomes

    deadline = time.monotonic() + deadline_seconds
    pool = ThreadPoolExecutor(
        max_workers=max(1, min(len(submittable), max_workers)),
        thread_name_prefix="stock",
    )
    try:
        futures = {
            pool.submit(_fetch_one, client, item, warehouses): item
            for item in submittable
        }
        try:
            for future in as_completed(futures, timeout=max(deadline - time.monotonic(), 0)):
                item = futures[future]
                try:
                    outcomes[item.requested] = future.result()
                except Exception:
                    # _fetch_one already turns every exception into a
                    # StockOutcome; this only guards against something
                    # escaping that (e.g. a cancelled future). Handling it
                    # here, separately from the deadline branch below,
                    # matters because on Python >=3.13 concurrent.futures.
                    # TimeoutError IS the builtin TimeoutError — an
                    # unguarded re-raise of a worker's own TimeoutError
                    # could otherwise be mistaken for the fan-out deadline
                    # and abort collection of every other still-pending item.
                    logger.exception(
                        "Stock fan-out worker raised for %s", item.requested,
                    )
                    outcomes[item.requested] = StockOutcome(status=STATUS_UNAVAILABLE)
        except FuturesTimeoutError:
            unfinished = sum(1 for item in submittable if item.requested not in outcomes)
            logger.warning(
                "Stock fan-out hit its %.1fs deadline with %s of %s items unfinished",
                deadline_seconds, unfinished, len(submittable),
            )
    finally:
        # Never wait. shutdown(wait=True) — which the context-manager form does
        # implicitly — would block on a still-running call and push us past the
        # router's cutoff, which is the one thing the deadline exists to avoid.
        pool.shutdown(wait=False, cancel_futures=True)

    for item in submittable:
        outcomes.setdefault(item.requested, StockOutcome(status=STATUS_UNAVAILABLE))
    return outcomes


def apply_self_heal(organization, resolved: list[ResolvedItem], outcomes: dict[str, StockOutcome]) -> None:
    """Phase C: upsert replica misses that 1C could identify, on the request thread.

    ``get_stock_and_prices`` is what returns the data the heal writes, which is
    why this belongs to the stock path rather than the catalog one.
    """
    for item in resolved:
        outcome = outcomes.get(item.requested)
        if item.product is not None or outcome is None or outcome.status != STATUS_OK:
            continue
        payload = outcome.data or {}
        resolved_sku = payload.get("sku") or item.requested
        img_urls = payload.get("img_url") or []
        fields = {
            "article": payload.get("article") or "",
            "name": payload.get("sku_name") or "",
            "price": payload.get("price"),
            "image_urls": img_urls,
            "barcodes": [item.requested] if item.is_barcode else [],
        }
        product, _ = Product.objects.update_or_create(
            organization=organization,
            sku=resolved_sku,
            defaults={
                "article": fields["article"],
                "name": fields["name"],
                "price": fields["price"],
                "image_urls": img_urls,
                "row_hash": row_hash(fields),
                "is_active": True,
                "deactivated_at": None,
                "pushed_at": timezone.now(),
            },
        )
        if item.is_barcode:
            ProductBarcode.objects.get_or_create(product=product, barcode=item.requested)
        outcome.product = {
            "sku": resolved_sku,
            "article": fields["article"],
            "sku_name": fields["name"],
            "price": fields["price"],
            "images": signed_image_paths(organization.id, resolved_sku, len(img_urls)),
        }


def fetch_stock_batch(user, items: list[RequestedItem], warehouse_codes: list[str]) -> list[dict]:
    """Phases A → B → C. Returns the response ``results`` list, in request order."""
    # `user.organization` is a plain FK access, so it loads every column on
    # first touch. Pass exactly this object to ConsultWebExchangeClient: the
    # pool threads call organization.decrypt_password() (-> FERNET_KEY) inside
    # _auth(), which only works without a query because the instance is
    # already fully loaded. Narrowing this with .only()/.defer() (or fetching
    # a fresh Organization that way) would make a worker thread hit the ORM
    # to fill in the missing field — exactly what phases A/C exist to avoid.
    organization = user.organization
    if not items:
        return []

    # Scoping the codes through the user's own warehouses is a tenancy control,
    # not just a 1C parameter. An empty selection means "all warehouses".
    selected = user.warehouses.filter(code__in=warehouse_codes)
    warehouses = ",".join(selected.values_list("code", flat=True)) if warehouse_codes else ""

    resolved = resolve_lookup_keys(organization, items)
    client = ConsultWebExchangeClient(organization, timeout=settings.STOCK_BATCH_READ_TIMEOUT_SECONDS)
    outcomes = fetch_stock_concurrently(
        client,
        resolved,
        warehouses,
        deadline_seconds=settings.STOCK_BATCH_DEADLINE_SECONDS,
        max_workers=settings.STOCK_FANOUT_CONCURRENCY,
    )
    apply_self_heal(organization, resolved, outcomes)

    results = []
    for item in resolved:
        outcome = outcomes[item.requested]
        row = {"sku": item.requested, "status": outcome.status}
        payload = outcome.data or {}
        row["stock"] = payload.get("stock") or []
        # The replica has no `unit` column and 1C reports it per lookup key —
        # a package barcode and the article can differ.
        if payload.get("unit"):
            row["unit"] = payload["unit"]
        if outcome.product is not None:
            row["product"] = outcome.product
        results.append(row)
    return results

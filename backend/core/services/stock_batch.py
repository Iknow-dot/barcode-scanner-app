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

from core.models import Product, ProductBarcode
from core.services.consult_web_exchange import ConsultWebExchangeError

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
    except ConsultWebExchangeError as exc:
        if exc.code == "PRODUCT_NOT_FOUND" and item.product is None:
            return StockOutcome(status=STATUS_NOT_FOUND)
        # A product we hold whose live lookup failed is degraded, not missing:
        # calling it "not found" sends the consultant hunting for something
        # that exists.
        return StockOutcome(status=STATUS_UNAVAILABLE)

    if item.product is None and not _has_identity(payload):
        return StockOutcome(status=STATUS_NOT_FOUND)
    return StockOutcome(status=STATUS_OK, data=payload)


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
    """
    outcomes: dict[str, StockOutcome] = {}
    submittable = []
    for item in resolved:
        if item.lookup_key is None:
            outcomes[item.requested] = StockOutcome(status=STATUS_NO_LOOKUP_KEY)
        else:
            submittable.append(item)

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
                outcomes[item.requested] = future.result()
        except FuturesTimeoutError:
            logger.warning(
                "Stock fan-out hit its %.1fs deadline with %s of %s items unfinished",
                deadline_seconds, len(submittable) - len(outcomes), len(submittable),
            )
    finally:
        # Never wait. shutdown(wait=True) — which the context-manager form does
        # implicitly — would block on a still-running call and push us past the
        # router's cutoff, which is the one thing the deadline exists to avoid.
        pool.shutdown(wait=False, cancel_futures=True)

    for item in submittable:
        outcomes.setdefault(item.requested, StockOutcome(status=STATUS_UNAVAILABLE))
    return outcomes

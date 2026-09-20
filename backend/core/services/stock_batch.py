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

from dataclasses import dataclass

from core.models import Product, ProductBarcode


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
    """Phase A: match every requested value against the replica, in two queries."""
    barcodes = {item.sku for item in items if item.is_barcode}
    skus = {item.sku for item in items if not item.is_barcode}

    by_barcode: dict[str, Product] = {}
    if barcodes:
        matches = ProductBarcode.objects.filter(
            product__organization=organization,
            barcode__in=barcodes,
            product__is_active=True,
        ).select_related("product").prefetch_related("product__barcodes")
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

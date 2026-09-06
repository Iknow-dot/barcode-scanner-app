"""Pure helpers for the catalog replica — no Django model imports, easy to unit-test."""
import hashlib
import json

from core.catalog.categories import normalize_category_chain


def row_hash(product: dict) -> str:
    """Stable sha256 over the synced fields; barcode order does not matter."""
    payload = json.dumps(
        {
            "article": product.get("article") or "",
            "name": product.get("name") or "",
            "price": str(product.get("price") if product.get("price") is not None else ""),
            "barcodes": sorted(product.get("barcodes") or []),
            "image_urls": product.get("image_urls") or [],
            "category": [[c["id"], c["name"]] for c in (normalize_category_chain(product.get("category")) or [])],
            "attributes": product.get("attributes") or {},
        },
        sort_keys=True, ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


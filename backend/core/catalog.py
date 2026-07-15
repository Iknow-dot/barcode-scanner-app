"""Pure helpers for the catalog replica — no Django model imports, easy to unit-test."""
import hashlib
import json


def row_hash(product: dict) -> str:
    """Stable sha256 over the synced fields; barcode order does not matter."""
    payload = json.dumps(
        {
            "article": product.get("article") or "",
            "name": product.get("name") or "",
            "price": str(product.get("price") if product.get("price") is not None else ""),
            "barcodes": sorted(product.get("barcodes") or []),
            "image_urls": product.get("image_urls") or [],
            "category": [[c.get("id"), c.get("name")] for c in (product.get("category") or [])],
            "attributes": product.get("attributes") or {},
        },
        sort_keys=True, ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def proxy_image_paths(sku: str, count: int) -> list[str]:
    """Relative proxy paths the frontend loads instead of raw 1C URLs."""
    return [f"catalog/products/{sku}/image/{i}/" for i in range(count)]

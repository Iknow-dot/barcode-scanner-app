"""Signed image-proxy URLs. The image endpoint is fetched by a native <img> tag
(no JWT header can ride along), so it authenticates via an HMAC signature minted
by the org-scoped, JWT-authenticated scan/search responses. A user only ever
receives signatures for their own org's products, so the signature both authorizes
and tenant-scopes the request; forging one for another org needs SECRET_KEY."""
import hashlib
import hmac

from django.conf import settings


def _sig(org_id, sku: str, idx: int) -> str:
    msg = f"{org_id}:{sku}:{idx}".encode("utf-8")
    return hmac.new(settings.SECRET_KEY.encode("utf-8"), msg, hashlib.sha256).hexdigest()[:32]


def signed_image_path(org_id, sku: str, idx: int) -> str:
    return f"catalog/products/{sku}/image/{idx}/?org={org_id}&sig={_sig(org_id, sku, idx)}"


def signed_image_paths(org_id, sku: str, count: int) -> list[str]:
    return [signed_image_path(org_id, sku, i) for i in range(count)]


def verify_image_sig(org_id, sku: str, idx: int, sig: str | None) -> bool:
    return hmac.compare_digest(_sig(org_id, sku, idx), sig or "")

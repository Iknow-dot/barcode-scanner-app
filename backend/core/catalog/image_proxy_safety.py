"""Safety guards for the image proxy: SSRF prevention + Content-Type allowlisting.

The image URL originates from 1C's push channel (semi-trusted), and the proxy
attaches the org's Basic-auth credentials and serves bytes on our own origin —
so both the outbound fetch and the served response must be constrained.
"""
import ipaddress
import socket
from urllib.parse import urlparse

# Response Content-Type allowlist. Deliberately excludes image/svg+xml (can carry script).
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


class UnsafeImageURL(Exception):
    """Raised when an image URL must not be fetched (bad scheme or non-public host)."""


def assert_safe_image_url(url: str) -> None:
    """Raise UnsafeImageURL unless `url` is https and every resolved IP is public."""
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise UnsafeImageURL(f"scheme not allowed: {parsed.scheme!r}")
    host = parsed.hostname
    if not host:
        raise UnsafeImageURL("missing host")
    try:
        infos = socket.getaddrinfo(host, parsed.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise UnsafeImageURL(f"dns resolution failed: {exc}")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_reserved or ip.is_multicast or ip.is_unspecified):
            raise UnsafeImageURL(f"non-public address: {ip}")


def sanitized_image_content_type(upstream_content_type: str | None) -> str | None:
    """Return an allowlisted image content type, or None if not allowed."""
    if not upstream_content_type:
        return None
    ct = upstream_content_type.split(";")[0].strip().lower()
    return ct if ct in ALLOWED_IMAGE_TYPES else None

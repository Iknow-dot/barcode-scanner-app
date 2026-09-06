"""Domain layer of the org-scoped catalog replica that 1C pushes into.

Row fingerprinting, category-chain normalization and upsert, the attribute
registry and projection, and the signed image proxy (URL signing plus fetch
safety). Views: ``core/views/catalog_ingest.py`` and
``core/views/catalog_read.py``; serializers and tests mirror them. Push-token
auth deliberately stays in ``core/ingest_auth.py``.

No re-exports, so the pure modules stay importable without Django.
"""

"""The 1C-facing catalog wire contract.

These shapes are what the partner system posts to us, and they are what the
`/api/integration/` ReDoc renders — change them only in step with 1C."""

from rest_framework import serializers


class CatalogIngestCategoryNodeSerializer(serializers.Serializer):
    id = serializers.CharField(
        help_text=(
            "Stable, per-organization 1C category id. Identity is by this id, not by name: "
            "re-pushing an id resolves to (and updates) that same node; a new id creates a new node. "
            "The tree is keyed by id, not by position — the same id anywhere in any product's chain is "
            "the same shared node. Keep each id at a consistent depth under a consistent parent, because "
            "re-pushing an id under a different parent silently repoints that one node (last write wins). "
            "Ids only need to be unique within your own organization."
        )
    )
    name = serializers.CharField(
        help_text=(
            "Current display name of this category node. Names are not identity and may change freely: "
            "re-pushing an existing id with a different name renames that node and refreshes its breadcrumb "
            "everywhere it appears, across the node's whole subtree — including descendant categories not in "
            "this push. A rename touches only category nodes, never other products' rows. An omitted or blank "
            "name stores an empty display name for that node."
        )
    )


class CatalogIngestProductSerializer(serializers.Serializer):
    sku = serializers.CharField(
        help_text="Stable product identifier (1C item code). Together with the organization it is the primary key of the replica row."
    )
    article = serializers.CharField(
        required=False, allow_blank=True,
        help_text="Human-facing article / model number.",
    )
    name = serializers.CharField(help_text="Display name; also what name search matches against.")
    price = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True,
        help_text="Display fallback only. The price shown at scan time is always fetched live from 1C.",
    )
    barcodes = serializers.ListField(
        child=serializers.CharField(), required=False,
        help_text="Every barcode that maps to this product.",
    )
    image_urls = serializers.ListField(
        child=serializers.CharField(), required=False,
        help_text="Absolute image URLs on your host; served to consultants via our authenticated image proxy (never copied or stored).",
    )
    category = CatalogIngestCategoryNodeSerializer(
        many=True, required=False,
        help_text=(
            "Full category ancestry for this product, ordered root→leaf. Each element's parent is the "
            "element before it, and the last element is the product's own category; nodes are keyed by "
            "their stable id (see the id/name fields) — categories have no separate endpoint. Omit or send "
            "[] for uncategorized. A chain that repeats an id (a cycle) or has an element with no id stores "
            "that one product uncategorized without failing the batch. A push replaces the whole product "
            "row, so always send the current full chain — omitting this field clears the category, the same "
            "as any other omitted field. See the endpoint description for the full mapping model."
        ),
    )
    attributes = serializers.DictField(
        required=False,
        help_text="Arbitrary per-org custom fields, stored verbatim. Hidden from consultants until an org admin marks a key visible.",
    )


class CatalogIngestRequestSerializer(serializers.Serializer):
    products = CatalogIngestProductSerializer(many=True)
    is_full = serializers.BooleanField(
        required=False, default=False,
        help_text="True when this batch is part of a full catalog snapshot (onboarding / re-baseline); stamps the full-push watermark. Omit or false for incremental change pushes.",
    )
    page = serializers.IntegerField(
        required=False,
        help_text="Optional 1-based page number when a full push is sent in chunks. Informational only — batches are processed independently and idempotently, in any order.",
    )


class CatalogIngestResponseSerializer(serializers.Serializer):
    received = serializers.IntegerField(help_text="Number of products in the request.")
    upserted = serializers.IntegerField(help_text="Rows created or updated (changed, or previously deactivated).")
    skipped = serializers.IntegerField(help_text="Unchanged rows skipped because their fingerprint matched.")


class CatalogDeactivateRequestSerializer(serializers.Serializer):
    skus = serializers.ListField(
        child=serializers.CharField(),
        help_text="SKUs to soft-deactivate (hidden from search; order history preserved). Re-pushing a SKU via /catalog/products/ reactivates it.",
    )


class CatalogDeactivateResponseSerializer(serializers.Serializer):
    deactivated = serializers.IntegerField(help_text="Number of active products that were deactivated.")


class OrderCompleteRequestSerializer(serializers.Serializer):
    order_id = serializers.IntegerField(
        help_text="The PurchaseOrder id — the number printed on the invoice (`order.id` token).",
    )


class OrderCompleteResponseSerializer(serializers.Serializer):
    order_id = serializers.IntegerField()
    status = serializers.CharField(help_text="Always 'completed' on success.")

"""Read-side catalog serializers served from the local replica."""

from rest_framework import serializers


class CatalogProductSerializer(serializers.Serializer):
    sku = serializers.CharField()
    article = serializers.CharField(allow_blank=True, required=False)
    name = serializers.CharField()
    price = serializers.DecimalField(max_digits=12, decimal_places=2, allow_null=True)
    image = serializers.CharField(allow_null=True)
    category_path = serializers.JSONField(required=False)


# ---------------------------------------------------------------------------
# Catalog ingest (external integration) — documentation serializers
#
# These describe the request/response shapes of the 1C push endpoints for the
# integration OpenAPI schema (see core/schema.py). The ingest views read
# request.data directly; these serializers are for drf-spectacular only.
# ---------------------------------------------------------------------------

class CatalogSyncStatusSerializer(serializers.Serializer):
    """Company-admin sync-health snapshot for the org's catalog replica."""
    health = serializers.CharField(help_text="never | error | stale | ok")
    has_synced = serializers.BooleanField()
    status = serializers.CharField()
    is_stale = serializers.BooleanField()
    stale_after_days = serializers.IntegerField()
    last_full_push_at = serializers.DateTimeField(allow_null=True)
    last_delta_push_at = serializers.DateTimeField(allow_null=True)
    last_delete_at = serializers.DateTimeField(allow_null=True)
    received = serializers.IntegerField()
    upserted = serializers.IntegerField()
    deactivated = serializers.IntegerField()
    images_failed = serializers.IntegerField()
    last_error = serializers.CharField(allow_blank=True)
    active_product_count = serializers.IntegerField()
    total_product_count = serializers.IntegerField()
    visible_attributes = serializers.JSONField()


class CatalogAdminProductSerializer(serializers.Serializer):
    """One product row for the company-admin catalog browser (list + drawer)."""
    sku = serializers.CharField()
    article = serializers.CharField(allow_blank=True)
    name = serializers.CharField()
    price = serializers.DecimalField(max_digits=12, decimal_places=2, allow_null=True)
    is_active = serializers.BooleanField()
    pushed_at = serializers.DateTimeField(allow_null=True)
    category_path = serializers.JSONField()
    images = serializers.ListField(child=serializers.CharField())
    barcodes = serializers.ListField(child=serializers.CharField())
    attributes = serializers.JSONField()


class CatalogCategoryNodeSerializer(serializers.Serializer):
    """One node of the org category tree; children is the same shape, recursively."""
    id = serializers.IntegerField()
    name = serializers.CharField()
    product_count = serializers.IntegerField()
    children = serializers.JSONField()

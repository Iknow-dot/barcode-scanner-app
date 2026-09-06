"""Per-consultant order statistics."""

from rest_framework import serializers


class ConsultantOrderStatsSerializer(serializers.Serializer):
    """One row of the order-analytics response (per consultant)."""
    user_id = serializers.IntegerField()
    username = serializers.CharField()
    orders_created = serializers.IntegerField()
    orders_confirmed = serializers.IntegerField()
    conversion_rate = serializers.FloatField()


# ---------------------------------------------------------------------------
# Catalog name search
# ---------------------------------------------------------------------------

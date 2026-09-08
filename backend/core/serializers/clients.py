"""Remote-client serializers: CheckClient/CreateClient payloads, RS.ge lookup
and the Photon address helpers."""

from rest_framework import serializers


class CheckClientRequestSerializer(serializers.Serializer):
    """User must provide identification_number, phone OR name (or several).

    Upstream matches all three against its single `IDPhone` field; the client
    layer picks which one to send.
    """

    identification_number = serializers.CharField(
        max_length=50, required=False, allow_blank=True, default='',
    )
    phone = serializers.CharField(
        max_length=50, required=False, allow_blank=True, default='',
    )
    name = serializers.CharField(
        max_length=255, required=False, allow_blank=True, default='',
    )

    def validate(self, attrs):
        if not any(
            attrs.get(field)
            for field in ('identification_number', 'phone', 'name')
        ):
            raise serializers.ValidationError(
                "Provide identification_number, phone or name."
            )
        return attrs


class CheckClientResponseSerializer(serializers.Serializer):
    """Normalized client response from CheckClient / CreateClient.

    Upstream 1C returns `name`, `address`, and `phone` for the customer
    object (plus a wrapper `status`). `raw` echoes the unwrapped upstream
    JSON so callers can recover unmapped fields without a backend code
    change.
    """

    name = serializers.CharField(required=False, allow_blank=True, default='')
    address = serializers.CharField(required=False, allow_blank=True, default='')
    phone = serializers.CharField(required=False, allow_blank=True, default='')
    raw = serializers.JSONField(required=False)


class CreateClientRequestSerializer(serializers.Serializer):
    """Payload for creating a client externally.

    Mirrors the 1C ConsultWebExchange CreateClient body — see
    `core/services/consult_web_exchange.py` for the upstream field-name
    mapping. `is_phys` distinguishes a physical person from a legal entity
    (defaults to True). The address is sent as a single string; lat/lng from
    the frontend map picker are intentionally not persisted.
    """

    first_name = serializers.CharField(max_length=255)
    last_name = serializers.CharField(max_length=255)
    identification_number = serializers.CharField(
        max_length=50, required=False, allow_blank=True, default='',
    )
    is_phys = serializers.BooleanField(required=False, default=True)
    phone = serializers.CharField(
        max_length=50, required=False, allow_blank=True, default='',
    )
    phone_2 = serializers.CharField(
        max_length=50, required=False, allow_blank=True, default='',
    )
    email = serializers.EmailField(required=False, allow_blank=True, default='')
    address_line = serializers.CharField(max_length=500, required=False, allow_blank=True, default='')


class RSGeLookupSerializer(serializers.Serializer):
    identification_number = serializers.CharField(
        max_length=50,
        required=True,
        allow_blank=False,
        help_text="Taxpayer identification number to look up on RS.ge.",
    )


class ReverseGeocodeRequestSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)


class SearchAddressesRequestSerializer(serializers.Serializer):
    """Forward address search query for the `clients/search-addresses/` endpoint."""

    q = serializers.CharField(
        max_length=200,
        help_text="Free-text address fragment to search for.",
    )
    limit = serializers.IntegerField(
        required=False,
        min_value=1,
        max_value=15,
        default=8,
        help_text="Maximum number of suggestions to return (1–15, default 8).",
    )

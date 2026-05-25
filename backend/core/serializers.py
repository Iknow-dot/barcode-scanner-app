import base64
import re

from django.contrib.auth import get_user_model
from rest_framework import serializers

from core.models import Organization, Warehouse, PurchaseOrder, PurchaseOrderItem
from users.serializers import UserSerializer

User = get_user_model()


# ---------------------------------------------------------------------------
# Organization
# ---------------------------------------------------------------------------

_WEB_SERVICE_URL_PATH_RE = re.compile(r'/+hs/consultwebexchange.*$', re.IGNORECASE)


def _validate_consult_web_exchange_base_url(value: str) -> str:
    """Strip trailing slash and reject values that include the endpoint suffix.

    The org-level URL must be the BASE only — the client appends
    `HS/ConsultWebExchange/{name}` itself.
    """
    if not value:
        return value
    cleaned = value.strip().rstrip('/')
    if _WEB_SERVICE_URL_PATH_RE.search('/' + cleaned):
        raise serializers.ValidationError(
            "Enter the BASE URL only — do NOT include '/HS/ConsultWebExchange/...'."
        )
    return cleaned


class OrganizationSerializer(serializers.ModelSerializer):
    users = UserSerializer(many=True, read_only=True)
    has_password = serializers.SerializerMethodField()
    clear_password = serializers.BooleanField(write_only=True, required=False, default=False)

    class Meta:
        model = Organization
        fields = '__all__'
        extra_kwargs = {
            'web_service_password': {'write_only': True, 'required': False},
        }

    def get_has_password(self, obj):
        return bool(obj.web_service_password)

    _INVOICE_LOGO_MAX_BYTES = 1_048_576  # 1 MiB
    _INVOICE_LOGO_MIME_RE = re.compile(
        r'^data:image/(png|jpeg|jpg|svg\+xml|webp);base64,(?P<payload>[A-Za-z0-9+/=\s]+)$'
    )

    def validate_invoice_logo(self, value):
        if not value:
            return value
        match = self._INVOICE_LOGO_MIME_RE.match(value)
        if not match:
            raise serializers.ValidationError(
                "invoice_logo must be a base64 data URL of an image "
                "(png, jpeg, svg+xml, or webp)."
            )
        try:
            decoded = base64.b64decode(match.group('payload'), validate=False)
        except (ValueError, TypeError) as exc:
            raise serializers.ValidationError(
                "invoice_logo base64 payload could not be decoded."
            ) from exc
        if len(decoded) > self._INVOICE_LOGO_MAX_BYTES:
            raise serializers.ValidationError(
                f"invoice_logo exceeds the {self._INVOICE_LOGO_MAX_BYTES} byte limit."
            )
        return value

    def validate_web_service_url(self, value):
        return _validate_consult_web_exchange_base_url(value)

    def create(self, validated_data):
        validated_data.pop('clear_password', False)
        password = validated_data.pop('web_service_password', None)
        organization = Organization(**validated_data)
        if password:
            organization.encrypt_password(password)
        organization.save()
        return organization

    def update(self, instance, validated_data):
        clear_password = validated_data.pop('clear_password', False)
        password = validated_data.pop('web_service_password', None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        if clear_password:
            instance.web_service_password = None
        elif password:
            instance.encrypt_password(password)

        instance.save()
        return instance


class OrganizationExternalServiceSerializer(serializers.ModelSerializer):
    """Serializer for company admins to update their organization's external service details."""
    clear_password = serializers.BooleanField(write_only=True, required=False, default=False)

    class Meta:
        model = Organization
        fields = ['web_service_url', 'web_service_username', 'web_service_password', 'clear_password']
        extra_kwargs = {
            'web_service_password': {'write_only': True, 'required': False},
            'web_service_url': {
                'help_text': (
                    "Per-org BASE URL (everything before '/HS/ConsultWebExchange/'). "
                    "The system appends 'HS/ConsultWebExchange/{CheckClient|CreateClient|GetStockAndPrices}'."
                ),
            },
        }

    def validate_web_service_url(self, value):
        return _validate_consult_web_exchange_base_url(value)

    def update(self, instance, validated_data):
        clear_password = validated_data.pop('clear_password', False)

        if clear_password:
            instance.web_service_password = None
            instance.web_service_username = validated_data.get('web_service_username', instance.web_service_username)
            instance.web_service_url = validated_data.get('web_service_url', instance.web_service_url)
        else:
            password = validated_data.pop('web_service_password', None)
            for attr, value in validated_data.items():
                setattr(instance, attr, value)
            if password:
                instance.encrypt_password(password)

        instance.save()
        return instance


class OrganizationInvoiceTemplateSerializer(serializers.ModelSerializer):
    """Serializer for company admins to update their organization's invoice template fields.

    Reuses `OrganizationSerializer.validate_invoice_logo` to keep the size cap
    and MIME allowlist in one place. `invoice_template_html` is sanitized and
    structurally validated via the dedicated sanitizer module.
    """

    class Meta:
        model = Organization
        fields = [
            'invoice_logo',
            'invoice_display_name',
            'invoice_address',
            'invoice_phone',
            'invoice_email',
            'invoice_footer_text',
            'invoice_template_html',
        ]

    def validate_invoice_logo(self, value):
        return OrganizationSerializer().validate_invoice_logo(value)

    def validate_invoice_template_html(self, value):
        from core.services.invoice_template_sanitizer import (
            InvoiceTemplateValidationError,
            sanitize_and_validate,
        )
        try:
            return sanitize_and_validate(value or '')
        except InvoiceTemplateValidationError as exc:
            raise serializers.ValidationError({'code': exc.code, 'detail': exc.detail})


# ---------------------------------------------------------------------------
# Warehouse �� full access (internal_admin, company_admin)
# ---------------------------------------------------------------------------

class WarehouseSerializer(serializers.ModelSerializer):
    user_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=User.objects.all(),
        write_only=True,
        required=False,
        source='users',
    )
    user_ids_read = serializers.PrimaryKeyRelatedField(
        many=True,
        read_only=True,
        source='users',
    )

    class Meta:
        model = Warehouse
        fields = ['id', 'name', 'code', 'user_ids', 'user_ids_read']


    def validate(self, attrs):
        """Inject organization for company_admin and enforce unique_together."""
        request = self.context.get('request')
        if request and request.user.role == User.Role.COMPANY_ADMIN:
            attrs['organization'] = request.user.organization

        # Manual unique_together check (organization, code)
        organization = attrs.get('organization')
        code = attrs.get('code')
        if organization and code:
            qs = Warehouse.objects.filter(organization=organization, code=code)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError({
                    'code': f'Warehouse with this code already exists in this organization.',
                })

        return super().validate(attrs)

    def _validate_users_belong_to_organization(self, users, organization):
        """Ensure every user in the list belongs to the warehouse's organization."""
        if not users or not organization:
            return
        invalid_users = [u for u in users if u.organization_id != organization.pk]
        if invalid_users:
            invalid_names = ', '.join(u.username for u in invalid_users)
            raise serializers.ValidationError({
                'user_ids': (
                    f"The following users do not belong to the warehouse's "
                    f"organization: {invalid_names}"
                ),
            })

    def create(self, validated_data):
        users = validated_data.pop('users', [])
        organization = validated_data.get('organization')
        self._validate_users_belong_to_organization(users, organization)

        warehouse = Warehouse.objects.create(**validated_data)
        if users:
            warehouse.users.set(users)
        return warehouse

    def update(self, instance, validated_data):
        users = validated_data.pop('users', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if users is not None:
            organization = instance.organization
            self._validate_users_belong_to_organization(users, organization)
            instance.users.set(users)
        return instance


# ---------------------------------------------------------------------------
# Warehouse — read-only, limited fields (company_user)
# ---------------------------------------------------------------------------

class WarehouseReadOnlySerializer(serializers.ModelSerializer):
    class Meta:
        model = Warehouse
        fields = ['id', 'name', 'organization', 'code']
        read_only_fields = fields

# ---------------------------------------------------------------------------
# Client (1C ConsultWebExchange)
# ---------------------------------------------------------------------------

class CheckClientRequestSerializer(serializers.Serializer):
    """User must provide identification_number OR phone (or both)."""

    identification_number = serializers.CharField(
        max_length=50, required=False, allow_blank=True, default='',
    )
    phone = serializers.CharField(
        max_length=50, required=False, allow_blank=True, default='',
    )

    def validate(self, attrs):
        if not attrs.get('identification_number') and not attrs.get('phone'):
            raise serializers.ValidationError(
                "Provide identification_number or phone."
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


# ---------------------------------------------------------------------------
# Purchase Order Items
# ---------------------------------------------------------------------------

class PurchaseOrderItemSerializer(serializers.ModelSerializer):
    line_total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    effective_price = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = PurchaseOrderItem
        fields = [
            'id', 'sku', 'sku_name', 'article', 'price', 'quantity',
            'warehouse_code', 'warehouse_name', 'unit',
            'discount_percent', 'discounted_price', 'effective_price',
            'line_total', 'added_at',
        ]
        read_only_fields = ['id', 'added_at', 'line_total', 'effective_price']


class AddOrderItemSerializer(serializers.Serializer):
    """Serializer for adding a product to an existing order."""
    sku = serializers.CharField(max_length=255)
    sku_name = serializers.CharField(max_length=255, required=False, default='')
    article = serializers.CharField(max_length=255, required=False, default='')
    price = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, default=0)
    quantity = serializers.IntegerField(min_value=1, required=False, default=1)
    warehouse_code = serializers.CharField(max_length=255, required=False, default='')
    warehouse_name = serializers.CharField(max_length=255, required=False, default='')
    unit = serializers.CharField(max_length=50, required=False, default='')
    discount_percent = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, default=0)
    discounted_price = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True, default=None)


class BulkUpdateOrderItemsDataSerializer(serializers.Serializer):
    """Whitelisted fields the bulk-update endpoint may set on each item.

    Per-warehouse quantity has its own update_item endpoint; only price,
    discount_percent, discounted_price, and unit are bulk-updatable.
    All fields are optional; at least one must be provided (validated by this
    serializer's validate method).
    """
    price = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False,
    )
    unit = serializers.CharField(max_length=50, required=False, allow_blank=True)
    discount_percent = serializers.DecimalField(
        max_digits=5, decimal_places=2, required=False,
    )
    discounted_price = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True,
    )

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError(
                'At least one field must be provided.'
            )
        return attrs


class BulkUpdateOrderItemsSerializer(serializers.Serializer):
    """Input for the bulk-update action: a non-empty list of item ids and a
    non-empty whitelisted data dict applied to every listed item."""
    item_ids = serializers.ListField(
        child=serializers.IntegerField(),
        allow_empty=False,
    )
    data = BulkUpdateOrderItemsDataSerializer()


# ---------------------------------------------------------------------------
# Purchase Order
# ---------------------------------------------------------------------------

class PurchaseOrderSerializer(serializers.ModelSerializer):
    items = PurchaseOrderItemSerializer(many=True, read_only=True)
    total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    created_by_username = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseOrder
        fields = [
            'id',
            'external_client_id', 'customer_name', 'customer_phone',
            'customer_identification_number', 'is_retail',
            'created_by', 'created_by_username',
            'status', 'delivery_type', 'delivery_address', 'delivery_date',
            'delivery_time_from', 'delivery_time_to', 'delivery_notes',
            'recipient_is_different', 'recipient_first_name',
            'recipient_last_name', 'recipient_phone',
            'notes', 'items', 'total', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_by', 'created_by_username', 'created_at', 'updated_at', 'total']
        extra_kwargs = {
            'customer_name': {'required': False, 'allow_blank': True},
            'customer_phone': {'required': False, 'allow_blank': True},
            'customer_identification_number': {'required': False, 'allow_blank': True},
            'external_client_id': {'required': False, 'allow_blank': True},
        }

    def validate(self, attrs):
        is_retail = attrs.get('is_retail')
        if is_retail is None:
            is_retail = getattr(self.instance, 'is_retail', False)
        if is_retail:
            # Retail orders map to the 1C retail counterparty and carry no
            # client data — blank the client fields server-side so a stray
            # value from the request can't leak in.
            for field in (
                'customer_name', 'customer_phone',
                'customer_identification_number', 'external_client_id',
            ):
                attrs[field] = ''
        else:
            name = attrs.get('customer_name')
            if name is None:
                name = getattr(self.instance, 'customer_name', '')
            if not (name or '').strip():
                raise serializers.ValidationError(
                    {'customer_name': 'This field is required for non-retail orders.'}
                )
        return attrs

    def get_created_by_username(self, obj):
        return obj.created_by.username if obj.created_by else ''

    def create(self, validated_data):
        request = self.context.get('request')
        validated_data['organization'] = request.user.organization
        validated_data['created_by'] = request.user
        return PurchaseOrder.objects.create(**validated_data)


class PurchaseOrderListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for listing orders (without full item details)."""
    created_by_username = serializers.SerializerMethodField()
    total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    items_count = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseOrder
        fields = [
            'id',
            'external_client_id', 'customer_name', 'customer_phone',
            'customer_identification_number', 'is_retail',
            'created_by', 'created_by_username',
            'status', 'delivery_type', 'total', 'items_count', 'created_at', 'updated_at',
        ]

    def get_created_by_username(self, obj):
        return obj.created_by.username if obj.created_by else ''

    def get_items_count(self, obj):
        return obj.items.count()


# ---------------------------------------------------------------------------
# RS.ge Lookup
# ---------------------------------------------------------------------------

class RSGeLookupSerializer(serializers.Serializer):
    identification_number = serializers.CharField(
        max_length=50,
        required=True,
        allow_blank=False,
        help_text="Taxpayer identification number to look up on RS.ge.",
    )


# ---------------------------------------------------------------------------
# Reverse Geocode (Nominatim)
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Product Search
# ---------------------------------------------------------------------------

class ProductSearchSerializer(serializers.Serializer):
    class StockSerializer(serializers.Serializer):
        warehouse = serializers.CharField(max_length=255)
        warehouse_name = serializers.CharField(max_length=255)
        quantity = serializers.IntegerField()
        price = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)

    is_barcode = serializers.BooleanField(write_only=True)
    sku = serializers.CharField(max_length=255)
    warehouses = serializers.ListField(child=serializers.CharField(max_length=255), write_only=True)
    article = serializers.CharField(max_length=255, read_only=True)
    price = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    sku_name = serializers.CharField(max_length=255, read_only=True)
    stock = serializers.ListField(read_only=True, child=StockSerializer())
    images = serializers.ListField(child=serializers.URLField(), read_only=True)

    class Meta:
        read_only_fields = [
            'article',
            'price',
            'sku',
            'sku_name',
            'stock',
            'images',
        ]
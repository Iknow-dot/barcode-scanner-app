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
            'discount_percent', 'discounted_price', 'is_gift', 'effective_price',
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
    is_gift = serializers.BooleanField(required=False, default=False)


class BulkUpdateOrderItemsDataSerializer(serializers.Serializer):
    """Whitelisted fields the bulk-update endpoint may set on each item.

    Per-warehouse quantity has its own update_item endpoint; only price,
    discount_percent, discounted_price, is_gift, and unit are bulk-updatable.
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
    is_gift = serializers.BooleanField(required=False)

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
        # 1C types these as Number and goods sold by weight come back
        # fractional; an IntegerField floored 2.5 kg to 2 and 0.5 kg to 0.
        # Decimal (serialized as a string, like `price` above) keeps them exact.
        quantity = serializers.DecimalField(max_digits=15, decimal_places=3)
        reserve = serializers.DecimalField(max_digits=15, decimal_places=3, read_only=True)
        price = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
        # 1C's per-row automatic discount (undocumented lowercase keys).
        # Omitted from the row entirely when the base doesn't send them.
        discount_percent = serializers.DecimalField(
            max_digits=5, decimal_places=2, read_only=True, source='discountpercent',
        )
        discounted_price = serializers.DecimalField(
            max_digits=10, decimal_places=2, read_only=True, source='discountedprice',
        )

    is_barcode = serializers.BooleanField(write_only=True)
    sku = serializers.CharField(max_length=255)
    warehouses = serializers.ListField(child=serializers.CharField(max_length=255), write_only=True)
    article = serializers.CharField(max_length=255, read_only=True)
    price = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    sku_name = serializers.CharField(max_length=255, read_only=True)
    unit = serializers.CharField(max_length=50, read_only=True)
    stock = serializers.ListField(read_only=True, child=StockSerializer())
    images = serializers.ListField(child=serializers.CharField(), read_only=True)
    stock_status = serializers.CharField(read_only=True, required=False)
    category_path = serializers.JSONField(read_only=True, required=False)
    attributes = serializers.JSONField(read_only=True, required=False)

    class Meta:
        read_only_fields = [
            'article',
            'price',
            'sku',
            'sku_name',
            'unit',
            'stock',
            'images',
            'stock_status',
            'category_path',
            'attributes',
        ]


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

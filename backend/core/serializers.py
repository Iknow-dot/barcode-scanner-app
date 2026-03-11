from django.contrib.auth import get_user_model
from rest_framework import serializers

from core.models import Organization, Warehouse, Customer, PurchaseOrder, PurchaseOrderItem
from users.serializers import UserSerializer

User = get_user_model()


# ---------------------------------------------------------------------------
# Organization
# ---------------------------------------------------------------------------

class OrganizationSerializer(serializers.ModelSerializer):
    users = UserSerializer(many=True, read_only=True)

    class Meta:
        model = Organization
        fields = '__all__'


class OrganizationExternalServiceSerializer(serializers.ModelSerializer):
    """Serializer for company admins to update their organization's external service details."""
    clear_password = serializers.BooleanField(write_only=True, required=False, default=False)

    class Meta:
        model = Organization
        fields = ['web_service_url', 'web_service_username', 'web_service_password', 'clear_password']
        extra_kwargs = {
            'web_service_password': {'write_only': True, 'required': False},
        }

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
# Customer
# ---------------------------------------------------------------------------

class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = [
            'id', 'first_name', 'last_name', 'phone',
            'email', 'identification_number', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']
        extra_kwargs = {
            'identification_number': {'required': True, 'allow_blank': False},
        }

    def validate(self, attrs):
        request = self.context.get('request')
        if request and hasattr(request.user, 'organization') and request.user.organization:
            attrs['organization'] = request.user.organization
        return attrs

    def create(self, validated_data):
        return Customer.objects.create(**validated_data)


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


# ---------------------------------------------------------------------------
# Purchase Order
# ---------------------------------------------------------------------------

class PurchaseOrderSerializer(serializers.ModelSerializer):
    items = PurchaseOrderItemSerializer(many=True, read_only=True)
    total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    customer_name = serializers.SerializerMethodField()
    created_by_username = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseOrder
        fields = [
            'id', 'customer', 'customer_name', 'created_by', 'created_by_username',
            'status', 'delivery_type', 'delivery_address', 'delivery_date',
            'delivery_time_from', 'delivery_time_to', 'delivery_notes',
            'notes', 'items', 'total', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_by', 'created_by_username', 'created_at', 'updated_at', 'total']

    def get_customer_name(self, obj):
        return str(obj.customer) if obj.customer else ''

    def get_created_by_username(self, obj):
        return obj.created_by.username if obj.created_by else ''

    def validate_customer(self, value):
        request = self.context.get('request')
        if request and hasattr(request.user, 'organization') and request.user.organization:
            if value.organization_id != request.user.organization_id:
                raise serializers.ValidationError('Customer does not belong to your organization.')
        return value

    def create(self, validated_data):
        request = self.context.get('request')
        validated_data['organization'] = request.user.organization
        validated_data['created_by'] = request.user
        return PurchaseOrder.objects.create(**validated_data)


class PurchaseOrderListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for listing orders (without full item details)."""
    customer_name = serializers.SerializerMethodField()
    created_by_username = serializers.SerializerMethodField()
    total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    items_count = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseOrder
        fields = [
            'id', 'customer', 'customer_name', 'created_by', 'created_by_username',
            'status', 'delivery_type', 'total', 'items_count', 'created_at', 'updated_at',
        ]

    def get_customer_name(self, obj):
        return str(obj.customer) if obj.customer else ''

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
# Product Search
# ---------------------------------------------------------------------------

class ProductSearchSerializer(serializers.Serializer):
    class StockSerializer(serializers.Serializer):
        warehouse = serializers.CharField(max_length=255)
        warehouse_name = serializers.CharField(max_length=255)
        quantity = serializers.IntegerField()

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
from django.contrib.auth import get_user_model
from rest_framework import serializers

from core.models import Organization, Warehouse
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
        fields = ['id', 'name', 'code', 'organization', 'user_ids', 'user_ids_read']


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
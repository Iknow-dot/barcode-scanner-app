"""Warehouse serializers, including org-scoped user assignment."""

from core.models import Warehouse
from rest_framework import serializers
from core.serializers.common import User
from users.serializers import scope_to_requester_organization, validate_same_organization


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

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        scope_to_requester_organization(self, 'user_ids', User)

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
                    'code': 'Warehouse with this code already exists in this organization.',
                })

        return super().validate(attrs)

    def create(self, validated_data):
        users = validated_data.pop('users', [])
        organization = validated_data.get('organization')
        validate_same_organization(users, organization, 'user_ids', "All users must belong to the warehouse's organization.")

        warehouse = Warehouse.objects.create(**validated_data)
        if users:
            warehouse.users.set(users)
        return warehouse

    def update(self, instance, validated_data):
        users = validated_data.pop('users', None)
        # Validate before any write so a rejected user_ids leaves the scalar
        # fields untouched too (there is no ATOMIC_REQUESTS to roll them back).
        if users is not None:
            validate_same_organization(
                users, instance.organization, 'user_ids',
                "All users must belong to the warehouse's organization.",
            )
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if users is not None:
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

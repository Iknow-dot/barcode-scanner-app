"""Warehouse serializers, including org-scoped user assignment."""

from core.models import Warehouse
from rest_framework import serializers
from core.serializers.common import User


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
        # Non-internal-admin requesters may only reference users from their
        # own organization. Scoping the queryset makes a cross-org id fail
        # with the same "Invalid pk" error as a nonexistent one, so the
        # endpoint can't be probed for other orgs' user ids or usernames.
        request = self.context.get('request')
        if (
            request is not None
            and request.user.is_authenticated
            and request.user.role != User.Role.INTERNAL_ADMIN
        ):
            self.fields['user_ids'].child_relation.queryset = (
                User.objects.filter(organization=request.user.organization)
            )

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

    def _validate_users_belong_to_organization(self, users, organization):
        """Ensure every user in the list belongs to the warehouse's organization."""
        if not users or not organization:
            return
        if any(u.organization_id != organization.pk for u in users):
            # Keep this generic: naming the offending users (or saying they
            # exist at all) would leak cross-org account information.
            raise serializers.ValidationError({
                'user_ids': "All users must belong to the warehouse's organization.",
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

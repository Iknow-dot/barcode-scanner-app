"""Warehouse serializers, including org-scoped user assignment."""

from core.models import Warehouse
from django.db import transaction
from rest_framework import serializers
from core.serializers.common import User
from users.serializers import scope_to_requester_organization, validate_same_organization


def lock_users(users):
    """Re-read the users under a row lock, in pk order.

    The same-org rule is a check-then-write on ``user.organization``, and the
    user endpoint can move a user between orgs concurrently; taking the same
    lock it takes (users/serializers.py) serializes the two. Ordering by pk
    keeps two concurrent attaches from deadlocking. (Postgres FOR UPDATE;
    SQLite ignores it, so the re-read alone is what the test suite exercises.)
    """
    if not users:
        return users
    return list(
        User.objects.select_for_update()
        .filter(pk__in=[u.pk for u in users])
        .order_by('pk')
    )


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

        # `organization` is not a serializer field, so DRF adds no
        # UniqueTogetherValidator and this manual check is the only guard.
        # Nothing is injected for an internal admin, so scope an update by the
        # warehouse's own org — otherwise a duplicate code skips the check and
        # hits the UNIQUE constraint as a 500.
        organization = attrs.get('organization')
        if organization is None and self.instance is not None:
            organization = self.instance.organization
        if organization is None:
            # A create with nothing to inject (internal admin): organization is
            # NOT NULL, so anything past here is an IntegrityError. Warehouses
            # for a given org are created in the Django admin (Organization →
            # Warehouses inline) or by that org's own admin.
            raise serializers.ValidationError({
                'organization': 'A warehouse must belong to an organization.',
            })

        code = attrs.get('code')
        if code:
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
        with transaction.atomic():
            users = lock_users(users)
            validate_same_organization(
                users, organization, 'user_ids',
                "All users must belong to the warehouse's organization.",
            )
            warehouse = Warehouse.objects.create(**validated_data)
            if users:
                warehouse.users.set(users)
        return warehouse

    def update(self, instance, validated_data):
        users = validated_data.pop('users', None)
        with transaction.atomic():
            # Validate before any write so a rejected user_ids leaves the scalar
            # fields untouched too, and hold the users' rows until the M2M write
            # lands so a concurrent org move can't slip past the check.
            if users is not None:
                users = lock_users(users)
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

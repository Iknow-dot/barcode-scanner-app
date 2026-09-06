import logging
from datetime import timedelta
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.utils import timezone
from django.utils.crypto import constant_time_compare
from rest_framework import serializers
from rest_framework_simplejwt.serializers import (
    TokenObtainPairSerializer,
    TokenRefreshSerializer,
)
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.utils import datetime_from_epoch
from users.exceptions import DeviceNotAllowedError, IPNotAllowedError
from users.models import AllowedIP
from core.ip_utils import get_client_ip, ip_in_allowlist
from core.models import Warehouse

logger = logging.getLogger(__name__)


User = get_user_model()


def org_refresh_lifetime(user):
    """Per-org idle session timeout as a timedelta, or None → global default."""
    org = getattr(user, 'organization', None)
    if org is not None and org.session_timeout_minutes:
        return timedelta(minutes=org.session_timeout_minutes)
    return None


def _sync_outstanding_expiry(token):
    # OutstandingToken rows are written before exp is re-stamped; keep the
    # blacklist bookkeeping (and flushexpiredtokens) truthful.
    OutstandingToken.objects.filter(jti=token['jti']).update(
        expires_at=datetime_from_epoch(token['exp']),
        token=str(token),
    )


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Custom JWT token serializer that adds user details (role, email,
    organization) as custom claims in the token and also returns them
    in the response body for convenience.

    The response body is shaped to match the contract expected by the
    React frontend (previously served by Flask):

        {
            "access_token": "...",
            "refresh_token": "...",
            "role": "company_user",
            "organization_id": 1,
            "organization_name": "Acme Corp",
            "warehouses": ["WH-01", "WH-02"],
            "user": {"id": 1, "username": "john"}
        }
    """

    device_id = serializers.CharField(
        required=False, allow_blank=True, write_only=True, max_length=64,
    )

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        # Add custom claims to the JWT payload
        token['username'] = user.username
        token['email'] = user.email
        token['role'] = user.role
        if user.organization_id:
            token['organization_id'] = user.organization_id
        lifetime = org_refresh_lifetime(user)
        if lifetime is not None:
            token.set_exp(lifetime=lifetime)
            _sync_outstanding_expiry(token)
        return token

    def _enforce_device_lock(self, presented_id):
        """Trust-on-first-use device binding.

        Returns the device ID to echo in the response, or None when the
        lock is disabled for this user. Accepting a presented ID at bind
        time is deliberate: every user of a shared device binds to that
        device's single stored ID.
        """
        if not self.user.device_lock_enabled:
            return None
        if not self.user.bound_device_id:
            bound_id = presented_id or uuid4().hex
            request = self.context.get('request')
            user_agent = request.META.get('HTTP_USER_AGENT', '') if request else ''
            # Atomic first-bind: only one concurrent login can claim the
            # empty slot; a loser falls through to the match check below.
            bound_now = User.objects.filter(
                pk=self.user.pk, bound_device_id='',
            ).update(
                bound_device_id=bound_id,
                device_bound_at=timezone.now(),
                device_label=user_agent[:256],
            )
            if bound_now:
                return bound_id
            self.user.refresh_from_db(
                fields=['bound_device_id', 'device_bound_at', 'device_label'])
        if not constant_time_compare(presented_id, self.user.bound_device_id):
            logger.warning(
                "Login denied for user %s: presented device does not match bound device",
                self.user.username)
            raise DeviceNotAllowedError(presented_id)
        return self.user.bound_device_id

    def validate(self, attrs):
        data = super().validate(attrs)

        # --- IP allowlist check (no rows = unrestricted) ---
        allowed = list(self.user.allowed_ips.values_list('ip_or_network', flat=True))
        if allowed:
            client_ip = get_client_ip(self.context.get('request'))
            if not ip_in_allowlist(client_ip, allowed):
                logger.warning(
                    "Login denied for user %s: IP %s not in allowlist",
                    self.user.username, client_ip,
                )
                raise IPNotAllowedError(client_ip)

        # --- Device lock check ---
        device_id_to_echo = self._enforce_device_lock(
            (attrs.get('device_id') or '').strip())

        # Rename keys to match the frontend expectation
        data['access_token'] = data.pop('access')
        data['refresh_token'] = data.pop('refresh')

        # Top-level fields the frontend reads directly
        data['role'] = self.user.role
        data['organization_id'] = self.user.organization_id
        data['organization_name'] = (
            self.user.organization.name if self.user.organization else None
        )
        data['gift_marking_enabled'] = bool(
            self.user.organization
            and self.user.organization.gift_marking_enabled
        )
        data['product_catalog_enabled'] = bool(
            self.user.organization
            and self.user.organization.product_catalog_enabled
        )

        # Warehouse names assigned to this user
        data['warehouses'] = list(
            self.user.warehouses.values_list('name', flat=True)
        )

        data['user'] = {
            'id': self.user.id,
            'username': self.user.username,
            'can_apply_discount': self.user.can_apply_discount,
            'max_discount_percent': str(self.user.max_discount_percent),
        }

        if device_id_to_echo is not None:
            data['device_id'] = device_id_to_echo

        return data


class CustomTokenRefreshSerializer(TokenRefreshSerializer):
    """Stock refresh + rotation, then re-stamps the rotated refresh token's
    expiry with the user's per-org idle timeout.

    The *incoming* token's own expiry is what enforces the timeout — this
    only ensures the next token in the rotation chain carries the org
    lifetime too. If the user lookup fails (deleted mid-session), stock
    behavior applies.
    """

    def validate(self, attrs):
        data = super().validate(attrs)
        rotated = data.get('refresh')
        if not rotated:
            return data
        token = RefreshToken(rotated)
        user = User.objects.select_related('organization').filter(
            pk=token.get('user_id'),
        ).first()
        lifetime = org_refresh_lifetime(user) if user else None
        if lifetime is not None:
            token.set_exp(lifetime=lifetime)
            _sync_outstanding_expiry(token)
            data['refresh'] = str(token)
        return data


class ClientIPSerializer(serializers.Serializer):
    ip = serializers.IPAddressField()


class UserSerializer(serializers.ModelSerializer):
    allowed_ips = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'role', 'organization',
            'first_name', 'last_name', 'is_active', 'last_login', 'allowed_ips',
        ]
        read_only_fields = ['last_login']

    def get_allowed_ips(self, obj):
        return [{'ip_or_network': ip.ip_or_network} for ip in obj.allowed_ips.all()]


class AllowedIPAddressSerializer(serializers.ModelSerializer):
    class Meta:
        model = AllowedIP
        fields = ["ip_or_network"]


def scope_to_requester_organization(serializer, field_name, model):
    """Narrow a many=True PrimaryKeyRelatedField to the requester's organization.

    Internal admins keep the unscoped queryset. For everyone else a cross-org
    pk fails with DRF's standard "Invalid pk" error, identical to a nonexistent
    pk, so the endpoint cannot be used to probe other orgs' ids. (The M2M
    ``.set()`` bypasses model validation, so this and
    ``validate_same_organization`` are the only guards.)
    """
    request = serializer.context.get('request')
    if (
        request is not None
        and request.user.is_authenticated
        and request.user.role != User.Role.INTERNAL_ADMIN
    ):
        serializer.fields[field_name].child_relation.queryset = (
            model.objects.filter(organization=request.user.organization)
        )


def validate_same_organization(objs, organization, field_name, message):
    """Reject objs whose organization differs from ``organization`` — for every role.

    Keep ``message`` generic: naming the offending rows (or admitting they
    exist) would leak cross-org data. Mirrors Warehouse.users.limit_choices_to,
    which is form-only and does not protect ``.set()``.
    """
    if not objs or not organization:
        return
    if any(o.organization_id != organization.pk for o in objs):
        raise serializers.ValidationError({field_name: message})


class _BaseUserSerializer(serializers.ModelSerializer):
    """
    Shared base for user serializers.  Subclasses control which fields
    are read-only (e.g. ``organization``).
    """
    password = serializers.CharField(write_only=True, required=False, min_length=8)
    allowed_ips = AllowedIPAddressSerializer(many=True, required=False)
    warehouse_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Warehouse.objects.all(),
        write_only=True,
        required=False,
        source='warehouses',
    )
    warehouse_ids_read = serializers.PrimaryKeyRelatedField(
        many=True,
        read_only=True,
        source='warehouses',
    )
    device_bound_at = serializers.DateTimeField(read_only=True)
    device_label = serializers.CharField(read_only=True)
    has_bound_device = serializers.SerializerMethodField()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        scope_to_requester_organization(self, 'warehouse_ids', Warehouse)

    class Meta:
        model = User
        fields = [
            'id',
            'username',
            'email',
            'role',
            'first_name',
            'last_name',
            'password',
            'is_active',
            'last_login',
            'organization',
            'allowed_ips',
            'warehouse_ids',
            'warehouse_ids_read',
            'can_apply_discount',
            'max_discount_percent',
            'device_lock_enabled',
            'device_bound_at',
            'device_label',
            'has_bound_device',
        ]
        read_only_fields = ['id', 'last_login']

    def get_has_bound_device(self, obj):
        return bool(obj.bound_device_id)

    # -- helpers shared by both serializers --

    def _create_user(self, validated_data):
        password = validated_data.pop('password')
        warehouses = validated_data.pop('warehouses', [])
        validate_same_organization(
            warehouses, validated_data.get('organization'), 'warehouse_ids', "All warehouses must belong to the user's organization.",
        )
        validated_data.pop('allowed_ips', None)
        # Device lock defaults ON for company users unless explicitly set.
        if (validated_data.get('role') == User.Role.COMPANY_USER
                and 'device_lock_enabled' not in validated_data):
            validated_data['device_lock_enabled'] = True
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        for ip_data in self.initial_data.get('allowed_ips', []):
            AllowedIP.objects.get_or_create(user=user, **ip_data)
        if warehouses:
            user.warehouses.set(warehouses)
        return user

    def update(self, instance, validated_data):
        # Defense-in-depth: CompanyUserPermission already blocks company
        # users from this viewset, but if this serializer is ever reused on
        # a surface reachable by them, the device lock must stay admin-only.
        request = self.context.get('request')
        if request and request.user.role == User.Role.COMPANY_USER:
            validated_data.pop('device_lock_enabled', None)
        password = validated_data.pop('password', None)
        warehouses = validated_data.pop('warehouses', None)
        if warehouses is not None:
            validate_same_organization(
                warehouses, validated_data.get('organization', instance.organization),
                'warehouse_ids', "All warehouses must belong to the user's organization.",
            )
        validated_data.pop('allowed_ips', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if password:
            instance.set_password(password)
        instance.save()
        if warehouses is not None:
            instance.warehouses.set(warehouses)
        if 'allowed_ips' in self.initial_data:
            instance.allowed_ips.all().delete()
            for ip_data in self.initial_data.get('allowed_ips', []):
                AllowedIP.objects.get_or_create(user=instance, **ip_data)
        return instance


class CompanyUserSerializer(_BaseUserSerializer):
    """
    Serializer used by **company admins**.
    ``organization`` is read-only — it is always set to the requesting
    admin's own organization so company admins cannot assign users to
    arbitrary organizations.
    """

    class Meta(_BaseUserSerializer.Meta):
        read_only_fields = ['id', 'organization']

    def create(self, validated_data):
        validated_data['organization'] = self.context['request'].user.organization
        return self._create_user(validated_data)


class InternalAdminUserSerializer(_BaseUserSerializer):
    """
    Serializer used by **internal admins** (superadmins).
    ``organization`` is writable — internal admins can assign users to
    any organization.
    """

    class Meta(_BaseUserSerializer.Meta):
        read_only_fields = ['id']

    def create(self, validated_data):
        return self._create_user(validated_data)
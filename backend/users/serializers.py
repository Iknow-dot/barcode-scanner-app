import ipaddress
import logging
from datetime import timedelta

from django.contrib.auth import get_user_model
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
from rest_framework_simplejwt.utils import datetime_from_epoch
from users.models import AllowedIP
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

    def _get_client_ip(self):
        """Extract the client IP address from the request."""
        request = self.context.get('request')
        if not request:
            return None
        xff = request.META.get('HTTP_X_FORWARDED_FOR')
        if xff:
            return xff.split(',')[0].strip()
        return request.META.get('REMOTE_ADDR')

    @staticmethod
    def _ip_is_allowed(client_ip_str, allowed_ips_qs):
        """
        Check whether *client_ip_str* matches at least one entry in
        *allowed_ips_qs*.  Each entry can be a plain IP (``192.168.1.10``)
        or a CIDR network (``192.168.1.0/24``).
        """
        try:
            client_ip = ipaddress.ip_address(client_ip_str)
        except ValueError:
            logger.warning("Could not parse client IP: %s", client_ip_str)
            return False

        for entry in allowed_ips_qs:
            value = entry.ip_or_network.strip()
            try:
                # Try as a single IP first
                if client_ip == ipaddress.ip_address(value):
                    return True
            except ValueError:
                pass
            try:
                # Try as a network (CIDR)
                if client_ip in ipaddress.ip_network(value, strict=False):
                    return True
            except ValueError:
                logger.warning("Invalid allowed IP/network entry: %s", value)
        return False

    def validate(self, attrs):
        data = super().validate(attrs)

        # --- IP allowlist check ---
        # If the user has allowed IPs configured, verify the client IP.
        allowed_ips = self.user.allowed_ips.all()
        if allowed_ips.exists():
            client_ip = self._get_client_ip()
            if not client_ip or not self._ip_is_allowed(client_ip, allowed_ips):
                logger.warning(
                    "Login denied for user %s: IP %s not in allowlist",
                    self.user.username, client_ip,
                )
                from users.exceptions import IPNotAllowedError
                raise IPNotAllowedError(client_ip)

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
        ]
        read_only_fields = ['id', 'last_login']

    # -- helpers shared by both serializers --

    def _create_user(self, validated_data):
        password = validated_data.pop('password')
        warehouses = validated_data.pop('warehouses', [])
        validated_data.pop('allowed_ips', None)
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        for ip_data in self.initial_data.get('allowed_ips', []):
            AllowedIP.objects.get_or_create(user=user, **ip_data)
        if warehouses:
            user.warehouses.set(warehouses)
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop('password', None)
        warehouses = validated_data.pop('warehouses', None)
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
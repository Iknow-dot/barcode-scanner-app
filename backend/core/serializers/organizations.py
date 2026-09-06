"""Organization serializers: the full record plus the external-service,
invoice-template and security sub-resource views."""

import base64
import re

from core.models import Organization
from rest_framework import serializers
from users.serializers import UserSerializer
from core.serializers.common import User, _validate_consult_web_exchange_base_url


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

    def validate_session_timeout_minutes(self, value):
        current = self.instance.session_timeout_minutes if self.instance else None
        if value == current:
            return value
        request = self.context.get('request')
        role = getattr(getattr(request, 'user', None), 'role', None)
        if role != User.Role.INTERNAL_ADMIN:
            raise serializers.ValidationError(
                'Only internal admins can change the session timeout.'
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


class OrganizationSecuritySerializer(serializers.ModelSerializer):
    """Serializer for company admins to manage their organization's security
    settings. Field-scoped on purpose — never widen to `__all__`."""

    class Meta:
        model = Organization
        fields = ['session_timeout_minutes']


# ---------------------------------------------------------------------------
# Warehouse �� full access (internal_admin, company_admin)
# ---------------------------------------------------------------------------

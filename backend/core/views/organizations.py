"""Organization CRUD plus the external-service, invoice-template and
security sub-resources."""

from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import status as http_status
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.ip_utils import is_valid_ip_or_network
from core.models import Organization, OrganizationPushAllowedIP
from core.permissions import OrganizationPermission
from core.serializers import (
    OrganizationSerializer,
    OrganizationExternalServiceSerializer,
    OrganizationInvoiceTemplateSerializer,
    OrganizationSecuritySerializer,
)
from core.views.common import no_organization_response
from users.models import AllowedIP, User


def _external_service_payload(organization: Organization) -> dict:
    """Shape shared by GET and PATCH of my-organization/external-service."""
    return {
        'web_service_url': organization.web_service_url,
        'web_service_username': organization.web_service_username,
        'has_password': bool(organization.web_service_password),
        'webhook_token': organization.webhook_token,
        'push_allowed_ips': list(
            organization.push_allowed_ips.values_list('ip_or_network', flat=True)
        ),
    }


@extend_schema_view(
    list=extend_schema(tags=['Organizations']),
    retrieve=extend_schema(tags=['Organizations']),
    create=extend_schema(tags=['Organizations']),
    update=extend_schema(tags=['Organizations']),
    partial_update=extend_schema(tags=['Organizations']),
    destroy=extend_schema(tags=['Organizations']),
    get_user_organization=extend_schema(tags=['Organizations']),
    external_service=extend_schema(tags=['Organizations']),
    rotate_external_service_token=extend_schema(tags=['Organizations']),
    invoice_template=extend_schema(tags=['Organizations']),
    security_settings=extend_schema(tags=['Organizations']),
    used_ips=extend_schema(tags=['Organizations']),
)
class OrganizationViewSet(ModelViewSet):
    serializer_class = OrganizationSerializer
    permission_classes = [OrganizationPermission]

    def get_queryset(self):
        user = self.request.user
        # Prefetch users + their allowed_ips so the nested UserSerializer doesn't
        # fire N+1 queries when org pages render the embedded users table.
        base = Organization.objects.prefetch_related('users__allowed_ips')
        if user.role == User.Role.INTERNAL_ADMIN:
            return base.all()
        return base.filter(pk=user.organization_id)

    @action(detail=False, methods=['get'], url_path='my-organization')
    def get_user_organization(self, request: Request) -> Response:
        user = request.user
        if user.organization:
            serializer = self.get_serializer(user.organization)
            return Response(serializer.data)
        return no_organization_response()

    @action(detail=False, methods=['get', 'patch'], url_path='my-organization/external-service')
    def external_service(self, request: Request) -> Response:
        """
        GET: Retrieve the current user's organization external service details.
        PATCH: Update the current user's organization external service details.

        Company-admin only; enforced by OrganizationPermission.
        """
        user = request.user
        if not user.organization:
            return no_organization_response()

        organization = user.organization

        if request.method == 'GET':
            return Response(_external_service_payload(organization))

        # PATCH
        serializer = OrganizationExternalServiceSerializer(organization, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        # Optional: replace the source-IP allowlist for the push token. Sending the
        # full desired list replaces the set; sending [] clears it (unrestricted).
        if 'push_allowed_ips' in request.data:
            raw = request.data.get('push_allowed_ips')
            # Shape first: a non-string entry used to reach .strip() as a 500,
            # and [null] used to clear the allowlist with a 200 — silently
            # making the push token unrestricted.
            if not isinstance(raw, list) or not all(isinstance(e, str) for e in raw):
                return Response(
                    {"code": "INVALID_IP", "detail": "push_allowed_ips must be a list of strings."},
                    status=http_status.HTTP_400_BAD_REQUEST,
                )
            cleaned = []
            for entry in raw:
                entry = entry.strip()
                if not entry:
                    continue
                if not is_valid_ip_or_network(entry):
                    return Response(
                        {"code": "INVALID_IP", "detail": f"Invalid IP or network: {entry}"},
                        status=http_status.HTTP_400_BAD_REQUEST,
                    )
                cleaned.append(entry)
            organization.push_allowed_ips.all().delete()
            OrganizationPushAllowedIP.objects.bulk_create([
                OrganizationPushAllowedIP(organization=organization, ip_or_network=ip)
                for ip in dict.fromkeys(cleaned)  # de-dupe, preserve order
            ])

        return Response(_external_service_payload(organization))

    @action(detail=False, methods=['post'], url_path='my-organization/external-service/rotate-token')
    def rotate_external_service_token(self, request: Request) -> Response:
        """POST: Rotate (regenerate) the organization's catalog-push token.

        Company-admin only (OrganizationPermission). Invalidates the previous token — the
        org's 1C must be reconfigured with the new value before it can push again.
        """
        user = request.user
        if not user.organization:
            return no_organization_response()
        organization = user.organization
        organization.rotate_webhook_token()
        return Response({"webhook_token": organization.webhook_token})

    @action(detail=False, methods=['get', 'patch'], url_path='my-organization/invoice-template')
    def invoice_template(self, request: Request) -> Response:
        """
        GET: Retrieve the current user's organization invoice template fields.
        PATCH: Update the current user's organization invoice template fields.

        Company-admin only; enforced by OrganizationPermission.
        """
        user = request.user
        if not user.organization:
            return no_organization_response()

        organization = user.organization

        if request.method == 'GET':
            serializer = OrganizationInvoiceTemplateSerializer(organization)
            return Response(serializer.data)

        # PATCH
        serializer = OrganizationInvoiceTemplateSerializer(organization, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(OrganizationInvoiceTemplateSerializer(organization).data)

    @action(detail=False, methods=['get', 'patch'], url_path='my-organization/security')
    def security_settings(self, request: Request) -> Response:
        """
        GET: Retrieve the current user's organization security settings.
        PATCH: Update the current user's organization security settings.

        Company-admin only; enforced by OrganizationPermission.
        """
        user = request.user
        if not user.organization:
            return no_organization_response()

        organization = user.organization

        if request.method == 'GET':
            return Response(OrganizationSecuritySerializer(organization).data)

        # PATCH
        serializer = OrganizationSecuritySerializer(organization, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(OrganizationSecuritySerializer(organization).data)

    @action(detail=True, methods=['get'], url_path='used-ips')
    def used_ips(self, request: Request, pk=None) -> Response:
        """
        Returns all unique IP addresses already used by users
        within the given organization.

        GET /api/v1/organizations/<pk>/used-ips/
        """
        organization = self.get_object()
        ips = (
            AllowedIP.objects
            .filter(user__organization=organization)
            .values_list('ip_or_network', flat=True)
            .distinct()
        )
        return Response(list(ips))

from rest_framework.permissions import BasePermission, SAFE_METHODS

from users.models import User



class OrganizationPermission(BasePermission):
    """
    - Internal admins: full access.
    - Company admins / company users: read-only on their own organization.
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        if request.user.role == User.Role.INTERNAL_ADMIN:
            return True

        # Company admins can manage their external service settings and invoice template
        if view.action in ('external_service', 'rotate_external_service_token', 'invoice_template', 'security_settings') and request.user.role == User.Role.COMPANY_ADMIN:
            return True

        # Non-admin roles: read-only actions only
        return view.action in ('retrieve', 'list', 'get_user_organization', 'used_ips')

    def has_object_permission(self, request, view, obj):
        if request.user.role == User.Role.INTERNAL_ADMIN:
            return True
        return obj == request.user.organization


class IsCompanyAdmin(BasePermission):
    """Access for company admins only (scoped to their organization)."""

    def has_permission(self, request, view):
        return (
                request.user
                and request.user.is_authenticated
                and request.user.role == User.Role.COMPANY_ADMIN
        )



class IsCompanyUserOrAdmin(BasePermission):
    """
    Access for company users and admins (scoped to their organization).
    """

    def has_permission(self, request, view):
        return (
                request.user
                and request.user.is_authenticated
                and request.user.role in (
                    User.Role.COMPANY_USER,
                    User.Role.COMPANY_ADMIN,
                )
        )


class IsCompanyAdminOrInternalAdmin(BasePermission):
    """Access for company admins and internal admins only (not company users)."""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in (
                User.Role.INTERNAL_ADMIN,
                User.Role.COMPANY_ADMIN,
            )
        )

class CompanyUserPermission(BasePermission):
    """
    - Internal admins: full access.
    - Company admins: full CRUD on users within their own organization.
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        return request.user.role in (
            User.Role.INTERNAL_ADMIN,
            User.Role.COMPANY_ADMIN,
        )

    def has_object_permission(self, request, view, obj):
        if request.user.role == User.Role.INTERNAL_ADMIN:
            return True
        return obj.organization == request.user.organization

class WarehousePermission(BasePermission):
    """
    - Internal admins: full access.
    - Company admins: full CRUD on their organization's warehouses.
    - Company users: read-only on their organization's warehouses.
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        if request.user.role == User.Role.INTERNAL_ADMIN:
            return True

        if request.user.role == User.Role.COMPANY_ADMIN:
            return True

        if request.user.role == User.Role.COMPANY_USER:
            return request.method in SAFE_METHODS

        return False

    def has_object_permission(self, request, view, obj):
        if request.user.role == User.Role.INTERNAL_ADMIN:
            return True
        # Scope to user's own organization
        return obj.organization == request.user.organization

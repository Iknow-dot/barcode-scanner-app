from rest_framework.permissions import BasePermission

from users.models import User


class OrganizationPermission(BasePermission):
    """
    - Internal Admins: full access to all organization endpoints.
    - Company Admins / Company Users: only retrieve (detail) for their own organization.
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        if request.user.role == User.Role.INTERNAL_ADMIN:
            return True

        # Non-admin users can only access the retrieve action
        if view.action in ['retrieve', 'list', 'get_user_organization']:
            return True

        return False

    def has_object_permission(self, request, view, obj):
        if request.user.role == User.Role.INTERNAL_ADMIN:
            return True

        # Non-admin users can only view their own organization
        return obj == request.user.organization

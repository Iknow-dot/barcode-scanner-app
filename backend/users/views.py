from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet
from rest_framework import status

from core.permissions import CompanyUserPermission
from users.models import User
from users.serializers import ClientIPSerializer, CompanyUserSerializer


class GetClientIPAPIView(APIView):
    serializer_class = ClientIPSerializer

    def get(self, request: Request) -> Response:
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff and "," in xff:
            ip = xff.split(",")[0].strip()
        else:
            ip = request.META.get("REMOTE_ADDR")

        serializer = self.serializer_class({"ip_address": ip})
        return Response(serializer.data)


class CompanyUserViewSet(ModelViewSet):
    """
    ViewSet for company admins to manage users within their organization.

    The user count is limited by the organization's ``employees_count`` field.
    Only users with the ``company_user`` role count towards this limit
    (admins are excluded).
    """
    serializer_class = CompanyUserSerializer
    permission_classes = [CompanyUserPermission]

    def get_queryset(self):
        user = self.request.user
        if user.role == User.Role.INTERNAL_ADMIN:
            return User.objects.filter(role=User.Role.COMPANY_USER)
        # Company admins see only their organization's company users
        return User.objects.filter(
            organization=user.organization,
            role=User.Role.COMPANY_USER,
        )

    def create(self, request, *args, **kwargs):
        organization = request.user.organization

        if organization.has_reached_user_limit():
            return Response(
                {
                    "code": "USER_LIMIT_REACHED",
                    "detail": f"User limit reached. Maximum {organization.employees_count} "
                              f"users (currently {organization.non_admin_user_count}).",
                    "limit": organization.employees_count,
                    "current_count": organization.non_admin_user_count,
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        return super().create(request, *args, **kwargs)

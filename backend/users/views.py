from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework.filters import SearchFilter
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet
from rest_framework import status
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.exceptions import TokenError

from core.permissions import CompanyUserPermission
from users.exceptions import IPNotAllowedError
from users.models import User
from users.serializers import ClientIPSerializer, CompanyUserSerializer


@extend_schema(tags=['Network'])
class GetClientIPAPIView(APIView):
    serializer_class = ClientIPSerializer

    def get(self, request: Request) -> Response:
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff and "," in xff:
            ip = xff.split(",")[0].strip()
        else:
            ip = request.META.get("REMOTE_ADDR")

        serializer = self.serializer_class({"ip": ip})
        return Response(serializer.data)


@extend_schema(tags=['Auth'])
class CustomTokenObtainPairView(TokenObtainPairView):
    """
    Custom login view that catches IPNotAllowedError raised during
    token validation and returns a structured JSON error response
    with a ``code`` field the frontend can use for translation.
    """

    def post(self, request: Request, *args, **kwargs) -> Response:
        try:
            return super().post(request, *args, **kwargs)
        except IPNotAllowedError as exc:
            return Response(
                {
                    "code": "IP_NOT_ALLOWED",
                    "detail": "Access denied: your IP address is not allowed.",
                },
                status=status.HTTP_403_FORBIDDEN,
            )


@extend_schema(tags=['Auth'])
class LogoutAPIView(APIView):
    """
    Blacklists the provided refresh token, effectively logging the user out.

    Send a POST request with ``{ "refresh": "<refresh_token>" }``.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        refresh_token = request.data.get('refresh')
        if not refresh_token:
            return Response(
                {'detail': 'Refresh token is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            token = RefreshToken(refresh_token)
            token.blacklist()
        except TokenError as e:
            return Response(
                {'detail': str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            {'detail': 'Successfully logged out.'},
            status=status.HTTP_200_OK,
        )


@extend_schema_view(
    list=extend_schema(tags=['Users']),
    retrieve=extend_schema(tags=['Users']),
    create=extend_schema(tags=['Users']),
    update=extend_schema(tags=['Users']),
    partial_update=extend_schema(tags=['Users']),
    destroy=extend_schema(tags=['Users']),
)
class UsersViewSet(ModelViewSet):
    """
    ViewSet for company admins to manage users within their organization.

    The user count is limited by the organization's ``employees_count`` field.
    Only users with the ``company_user`` role count towards this limit
    (admins are excluded).

    Supports query parameters:
    - search: searches username, email, first_name, last_name
    - organization: filter by organization ID
    - role: filter by user role
    """
    serializer_class = CompanyUserSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ['organization', 'role']
    search_fields = ['username', 'email', 'first_name', 'last_name']

    def get_queryset(self):
        user = self.request.user
        if user.role == User.Role.INTERNAL_ADMIN:
            return User.objects.all()
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

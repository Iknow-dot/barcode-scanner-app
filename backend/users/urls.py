from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
    TokenVerifyView,
)

from users.views import GetClientIPAPIView, CompanyUserViewSet, LogoutAPIView

router = DefaultRouter()
router.register(r'company-users', CompanyUserViewSet, basename='company-user')

urlpatterns = [
    # JWT Authentication endpoints
    path('auth/login/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('auth/verify/', TokenVerifyView.as_view(), name='token_verify'),
    path('auth/logout/', LogoutAPIView.as_view(), name='token_logout'),

    path('client-ip/', GetClientIPAPIView.as_view(), name='client-ip'),
    path('', include(router.urls)),
]

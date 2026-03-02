from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import (
    TokenRefreshView,
    TokenVerifyView,
)

from users.views import (
    CustomTokenObtainPairView,
    GetClientIPAPIView,
    UsersViewSet,
    LogoutAPIView,
)

router = DefaultRouter()
router.register(r'', UsersViewSet, basename='company-user')

urlpatterns = [
    # JWT Authentication endpoints
    path('auth/login/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('auth/verify/', TokenVerifyView.as_view(), name='token_verify'),
    path('auth/logout/', LogoutAPIView.as_view(), name='token_logout'),

    path('ip/', GetClientIPAPIView.as_view(), name='client-ip'),
    path('', include(router.urls)),
]

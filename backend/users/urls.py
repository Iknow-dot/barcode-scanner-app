from django.urls import path, include
from rest_framework.routers import DefaultRouter

from users.views import GetClientIPAPIView, CompanyUserViewSet

router = DefaultRouter()
router.register(r'company-users', CompanyUserViewSet, basename='company-user')

urlpatterns = [
    path('client-ip/', GetClientIPAPIView.as_view(), name='client-ip'),
    path('', include(router.urls)),
]
